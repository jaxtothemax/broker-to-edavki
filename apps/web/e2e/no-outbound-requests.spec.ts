/**
 * Nothing leaves the device (#2, ADR 0002): importing broker files, filling in
 * the taxpayer's details and reaching the results makes no request outside the
 * app's own origin, and none that carries what the user typed or imported.
 * Node tests cover what the engine worker locks away (handle.test.ts); this
 * proves it for the real worker, under the real Content Security Policy, in a
 * real browser.
 *
 * Every request is recorded from the browser context, not the page, so the
 * engine worker's are counted too: `context.on("request")` reports requests
 * from dedicated workers as well, and a probe below proves it, in each browser
 * the suite runs in. WebSockets are not requests to that event, so they are
 * recorded through `context.routeWebSocket`, which also answers every socket
 * itself: none ever connects. The main test also runs its browser behind a
 * sinkhole proxy that refuses every request and exempts only the app's own
 * host, so were the policy ever lost the synthetic data would still reach no
 * host, while the recorder still lists the request and the check still fails.
 * The policy is injected only by the production build, so these run against
 * `vite preview`, as playwright.config.ts does.
 *
 * The sinkhole is a proxy and not request interception (`context.route`) on
 * purpose: the engine worker starts from a blob: URL, and with interception on
 * WebKit cannot load that URL at all, even for a request the handler lets
 * through (WebKitBlobResource error 1). The import is then never read. No test
 * that starts the engine worker may register a route.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Made up for this test and planted in the input. Each is plain letters or
 * digits, so percent-encoding cannot hide it, and none can come from anything
 * the app legitimately requests (its asset names are hashes).
 */
const SENTINELS = {
  // Fails the Slovenian mod-11 check digit, so it cannot be a real tax number:
  // weights 8 to 2 over the first seven digits give sum 171, 171 mod 11 = 6,
  // expected check digit 5, but the number ends in 3.
  taxNumber: "90817263",
  firstName: "Zxqfirst",
  lastName: "Zxqlast",
  street: "Zxqstreet",
  fileStem: "zxqfile",
} as const;

const ALL_SENTINELS: readonly string[] = Object.values(SENTINELS);

/**
 * The exact paths the app may fetch from its own origin: the project's
 * published rate snapshot (ADR 0002), and nothing else. The app does not
 * download it yet: the snapshot ships bundled and the engine loads it as
 * modules (ADR 0005, ADR 0013 section 3), so the list is empty. The day the
 * download lands, its one path goes here, in the same PR.
 */
const PERMITTED_FETCH_PATHS: readonly string[] = [];

/**
 * Requests a script starts itself, as opposed to the page's own assets
 * (documents, modules, styles, fonts, images). Firefox and WebKit give
 * sendBeacon its own type. Only the message differs: every own-origin request
 * is path-checked.
 */
const FETCH_TYPES: ReadonlySet<string> = new Set([
  "fetch",
  "xhr",
  "eventsource",
  "websocket",
  "ping",
  "beacon",
]);

/** Where `vite preview` serves the production build from. */
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));

/**
 * The paths the built app may be asked for from its own origin: the files that
 * really are in the build output, the root and /index.html. Read at test time,
 * so a filename shape is never what lets a request through. WebKit reports a
 * module a worker imports as an xhr, so the resource type cannot tell a chunk
 * load from a fetch of data; the exact file can.
 */
function builtPaths(dist: string = DIST): Set<string> {
  let files: string[];
  try {
    files = readdirSync(dist, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(dist, `${entry.parentPath}${sep}${entry.name}`));
  } catch {
    throw new Error("apps/web/dist is missing: build the web app first");
  }
  const paths = new Set(["/", "/index.html"]);
  for (const file of files) paths.add(`/${file.split(sep).join("/")}`);
  return paths;
}

/** The engine worker's bundle: only the worker's own import asks for it. */
const ENGINE_BUNDLE = /\/engine\.worker[^/]*\.js/;

/** A host that cannot resolve (RFC 2606), answered by the test, not the net. */
const FOREIGN = "https://cross-origin.invalid";

interface Seen {
  readonly url: string;
  readonly method: string;
  readonly resourceType: string;
  /** Header values and body together: where a sentinel could ride along. */
  readonly carried: string;
}

/**
 * Records every request the context makes, from pages and workers alike, and
 * every WebSocket (which `context.on("request")` does not report). A socket is
 * answered here and never connected, so it cannot reach a server.
 */
async function record(context: BrowserContext): Promise<Seen[]> {
  const seen: Seen[] = [];
  await context.routeWebSocket(/.*/, async (socket) => {
    seen.push({
      url: socket.url(),
      method: "GET",
      resourceType: "websocket",
      carried: "",
    });
    await socket.close();
  });
  context.on("request", (request) => {
    seen.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      // latin1 keeps every byte, so an ASCII sentinel is found in any body.
      carried: [
        ...Object.values(request.headers()),
        request.postDataBuffer()?.toString("latin1") ?? "",
      ].join("\n"),
    });
  });
  return seen;
}

function originOf(baseURL: string | undefined): string {
  if (baseURL === undefined) {
    throw new Error("playwright.config.ts sets no baseURL");
  }
  return new URL(baseURL).origin;
}

type Destination = "local" | "own-origin" | "foreign";

/**
 * Where a request goes. data: and blob: never leave the browser (a blob's
 * origin is the page that made it); anything that does not parse counts as
 * foreign, so a malformed address fails the test instead of passing it.
 */
function destination(url: string, origin: string): Destination {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "foreign";
  }
  if (parsed.protocol === "data:") return "local";
  if (parsed.protocol === "blob:") {
    return parsed.origin === origin ? "local" : "foreign";
  }
  return parsed.origin === origin ? "own-origin" : "foreign";
}

/**
 * A fetch from the app's own origin is permitted on an exact path, with no
 * query: nothing about the user's files rides along in an address.
 */
function isPermittedFetch(
  url: string,
  origin: string,
  permitted: readonly string[],
): boolean {
  const parsed = new URL(url);
  return (
    parsed.origin === origin &&
    parsed.search === "" &&
    permitted.includes(parsed.pathname)
  );
}

/** Every request that leaves the origin, or asks for what the build lacks. */
function offenders(
  seen: readonly Seen[],
  origin: string,
  built: ReadonlySet<string>,
  permitted: readonly string[],
): string[] {
  return seen.flatMap((request) => {
    const where = destination(request.url, origin);
    const label = `${request.method} ${request.url} (${request.resourceType})`;
    if (where === "foreign") return [`${label} leaves the app's origin`];
    if (where === "local") return [];
    // A plain GET of a file the build holds is code the app ships, not data it
    // sends; anything else from the own origin (a third party's host in
    // production, whose logs would hold the path) must be a permitted fetch.
    const parsed = new URL(request.url);
    const isBuiltFile =
      request.method === "GET" &&
      parsed.search === "" &&
      built.has(parsed.pathname);
    if (isBuiltFile || isPermittedFetch(request.url, origin, permitted)) {
      return [];
    }
    return [
      FETCH_TYPES.has(request.resourceType)
        ? `${label} is a fetch other than the rate snapshot`
        : `${label} is not a file of the build`,
    ];
  });
}

function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Every request whose address, headers or body holds a sentinel. */
function leaks(seen: readonly Seen[], sentinels: readonly string[]): string[] {
  return seen.flatMap((request) => {
    const label = `${request.method} ${request.url}`;
    const haystack = [request.url, decoded(request.url), request.carried]
      .join("\n")
      .toLowerCase();
    return sentinels
      .filter((sentinel) => haystack.includes(sentinel.toLowerCase()))
      .map((sentinel) => `${label} carries ${sentinel}`);
  });
}

const fixtureBytes = (name: string) =>
  readFileSync(
    fileURLToPath(
      new URL(
        `../../../packages/brokers/test/fixtures/trading212/${name}`,
        import.meta.url,
      ),
    ),
  );

const heading = (page: Page) => page.locator("#main h1");

/** The sources the built page's policy gives `connect-src`. */
async function connectSources(page: Page): Promise<string[]> {
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  const directive = (policy ?? "")
    .split(";")
    .map((part) => part.trim().split(/\s+/))
    .find(([name]) => name === "connect-src");
  return directive?.slice(1) ?? [];
}

/** Answers the foreign host here, so nothing leaves the machine. */
async function answerForeign(context: BrowserContext): Promise<void> {
  await context.route(`${FOREIGN}/**`, async (route) => {
    await route.fulfill({
      status: 204,
      headers: { "access-control-allow-origin": "*" },
    });
  });
}

/**
 * A proxy that answers every request with 502 and never forwards one. The
 * browser is pointed at it with the app's own host exempt, so were the policy
 * ever lost a request to another host would end here and reach no real host.
 * The recorder (context.on("request")) still lists the request, so the
 * offender check still fails the test. It listens on loopback only.
 */
interface Sinkhole {
  readonly proxy: { readonly server: string; readonly bypass: string };
  /** What the proxy was asked for: "GET http://host/path", "CONNECT host:443". */
  readonly asked: string[];
}

async function withSinkhole(
  bypass: string,
  run: (sinkhole: Sinkhole) => Promise<void>,
): Promise<void> {
  const asked: string[] = [];
  const server = createServer((request, response) => {
    asked.push(`${request.method ?? ""} ${request.url ?? ""}`);
    // A body, so a navigation to a sunk host finishes in every browser.
    response
      .writeHead(502, { "content-type": "text/plain", connection: "close" })
      .end("sinkhole");
  });
  // https goes through a tunnel: only the host and port are ever seen.
  server.on("connect", (request, socket) => {
    asked.push(`CONNECT ${request.url ?? ""}`);
    socket.on("error", () => undefined);
    socket.end("HTTP/1.1 502 Bad Gateway\r\nconnection: close\r\n\r\n");
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("the sinkhole has no port");
    }
    await run({
      proxy: { server: `http://127.0.0.1:${String(address.port)}`, bypass },
      asked,
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
}

/**
 * A test whose browser has no route to any host but the app's own: the proxy
 * is the context's, so a foreign request is sunk, whatever the page does.
 */
const sealed = test.extend<{ sinkhole: Sinkhole }>({
  sinkhole: async ({ baseURL }, use) => {
    const host = new URL(originOf(baseURL)).hostname;
    await withSinkhole(host, use);
  },
  proxy: async ({ sinkhole }, use) => {
    await use(sinkhole.proxy);
  },
});

/** A `fetch` the page makes to the foreign host; whether it was sent. */
function fetchForeign(
  page: Page,
  target: string,
  body: string,
): Promise<{ readonly sent: boolean; readonly violations: string[] }> {
  return page.evaluate(
    async ({ target: url, body: payload }) => {
      const violations: string[] = [];
      const listen = (event: SecurityPolicyViolationEvent) => {
        violations.push(event.violatedDirective);
      };
      document.addEventListener("securitypolicyviolation", listen);
      let sent = true;
      try {
        await fetch(url, { method: "POST", mode: "no-cors", body: payload });
      } catch {
        sent = false;
      }
      // The browser reports a policy violation as a task of its own.
      for (let waited = 0; waited < 1000; waited += 20) {
        if (sent || violations.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      document.removeEventListener("securitypolicyviolation", listen);
      return { sent, violations };
    },
    { target, body },
  );
}

/**
 * A dedicated worker, started from a blob: as the engine's is, that fetches
 * `target` and reports back. The blob worker inherits the page's policy, so
 * `target` must be an absolute address on the page's origin.
 */
async function fetchFromWorker(page: Page, target: string): Promise<void> {
  await page.evaluate(async (url) => {
    const source = [
      `fetch(${JSON.stringify(url)})`,
      ".catch(() => undefined)",
      '.finally(() => { postMessage("done"); });',
    ].join("");
    const blob = URL.createObjectURL(
      new Blob([source], { type: "text/javascript" }),
    );
    const worker = new Worker(blob);
    try {
      await new Promise<void>((resolve) => {
        worker.onmessage = () => {
          resolve();
        };
        worker.onerror = () => {
          resolve();
        };
      });
    } finally {
      worker.terminate();
      URL.revokeObjectURL(blob);
    }
  }, target);
}

// Registers no route (see the file comment): the engine worker's blob: would
// not load in WebKit, and nothing would be read.
sealed(
  "an import to the results makes no outbound request",
  async ({ baseURL, context, page, sinkhole }) => {
    const origin = originOf(baseURL);
    const seen = await record(context);
    const name = `${SENTINELS.firstName} ${SENTINELS.lastName}`;
    const older = `${SENTINELS.fileStem}-2025.csv`;
    const newer = `${SENTINELS.fileStem}-2026.csv`;

    await page.goto("/");
    await page.locator("input[value=en]").check({ force: true });
    expect(await connectSources(page)).toContain("'self'");

    await page.getByRole("button", { name: "Use my files" }).click();
    await page.locator('input[type="file"]').setInputFiles([
      {
        name: older,
        mimeType: "text/csv",
        buffer: fixtureBytes("t212-invest-v3-2025.csv"),
      },
      {
        name: newer,
        mimeType: "text/csv",
        buffer: fixtureBytes("t212-invest-v4-2026.csv"),
      },
    ]);
    await expect(page.getByText("Trading 212, 6 Jan 2026")).toBeVisible();
    // The sentinels must reach the app, or their absence from the requests
    // would prove nothing.
    await expect(page.locator(".file-name")).toHaveText([older, newer]);

    await page.locator(".actions-row .btn-primary").click();
    await page.locator("#details-taxNumber").fill(SENTINELS.taxNumber);
    await page.locator("#details-name").fill(name);
    await page.locator("#details-address").fill(`${SENTINELS.street} 7`);
    const preview = page.locator(".xml-preview");
    await expect(preview).toContainText(SENTINELS.taxNumber);
    await expect(preview).toContainText(name);
    await expect(preview).toContainText(SENTINELS.street);

    await page.getByRole("button", { name: "See results" }).click();
    await expect(heading(page)).toHaveText("Overview");
    await expect(page.getByText("Your results are ready.")).toBeAttached();
    await expect(
      page.getByRole("button", { name: "Download Doh-KDVP" }),
    ).toBeVisible();
    // Give a late beacon its chance before the requests are counted.
    await page.waitForLoadState("networkidle");

    // The engine worker really ran, and the recorder counted its requests: the
    // page never asks for the engine's bundle, only the worker's import does.
    const engineStarted = () =>
      seen.some((request) => ENGINE_BUNDLE.test(request.url));
    await expect
      .poll(engineStarted, {
        message: "the recorder never saw the engine worker's bundle load",
      })
      .toBe(true);

    expect(
      offenders(seen, origin, builtPaths(), PERMITTED_FETCH_PATHS),
    ).toEqual([]);
    expect(leaks(seen, ALL_SENTINELS)).toEqual([]);
    // A second witness besides the recorder: nothing reached the proxy either.
    expect(sinkhole.asked).toEqual([]);
  },
);

sealed(
  "a request to another host is sunk, and the check fails on it",
  async ({ baseURL, context, page, sinkhole }) => {
    // The check behind the main test's safety net: were the proxy not wired in,
    // or a browser to ignore it, the main test would pass with no host sunk and
    // a lost policy would send the synthetic data out.
    const origin = originOf(baseURL);
    const seen = await record(context);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The app's own origin is exempt: it must not reach the proxy.
    expect(sinkhole.asked).toEqual([]);

    // A navigation, unlike a fetch, is not held back by the page's policy, so
    // this asks the proxy in both schemes whatever the policy says.
    const plain = `${FOREIGN.replace("https:", "http:")}/sunk`;
    const secure = `${FOREIGN}/sunk`;
    for (const target of [plain, secure]) {
      await page.goto(target, { timeout: 10_000 }).catch(() => undefined);
    }
    await expect
      .poll(() => sinkhole.asked.join("\n"), {
        message: "the proxy never saw the requests to another host",
      })
      .toContain(`GET ${plain}`);
    await expect
      .poll(() => sinkhole.asked.join("\n"), {
        message: "the proxy never saw the tunnel to another host",
      })
      .toContain(`CONNECT ${new URL(FOREIGN).hostname}:443`);
    // Everything it was asked for is for the foreign host, none for the app.
    expect(
      sinkhole.asked.filter(
        (line) => !line.includes(new URL(FOREIGN).hostname),
      ),
    ).toEqual([]);

    await expect
      .poll(() => seen.map((request) => request.url), {
        message: "the recorder missed a request to another host",
      })
      .toEqual(expect.arrayContaining([plain, secure]));
    const outside = offenders(
      seen,
      origin,
      builtPaths(),
      PERMITTED_FETCH_PATHS,
    ).join("\n");
    expect(outside).toContain(plain);
    expect(outside).toContain(secure);
  },
);

test("the built page's policy keeps connections to its own origin", async ({
  page,
}) => {
  await page.goto("/");
  // Exactly the page's own origin: no wildcard, no scheme, no host beside it.
  // The day the opt-in LLM check's origin lands (ADR 0008, docs/adr), it goes
  // here in the same PR, as the rate snapshot's path does in
  // PERMITTED_FETCH_PATHS.
  expect(await connectSources(page)).toEqual(["'self'"]);
});

test("the policy refuses a fetch to another origin", async ({
  context,
  page,
}) => {
  await answerForeign(context);
  await page.goto("/");
  const { sent, violations } = await fetchForeign(
    page,
    `${FOREIGN}/refused`,
    SENTINELS.taxNumber,
  );
  expect(sent).toBe(false);
  expect(violations.join(" ")).toMatch(/^connect-src/);
});

test("the recorder counts a request a worker makes", async ({
  baseURL,
  context,
  page,
}) => {
  // The check behind the main test: were the recorder blind to workers, a
  // worker that sent data out would go unseen and that test would still pass.
  const origin = originOf(baseURL);
  const seen = await record(context);
  await page.goto("/");
  const probe = new URL("/probe-made-by-a-worker", origin).href;
  await fetchFromWorker(page, probe);
  await expect
    .poll(() => seen.map((request) => request.url), {
      message: "the recorder is blind to requests made by a worker",
    })
    .toContain(probe);
  // And a worker's fetch is not the rate snapshot, so the check fails on it.
  const outside = offenders(seen, origin, builtPaths(), PERMITTED_FETCH_PATHS);
  expect(outside.join("\n")).toContain(probe);
});

test.describe("with the page's policy bypassed", () => {
  // A control: were the policy ever lost, the recorder is what would still
  // catch a leak, a fetch through context.on("request"), a WebSocket through
  // context.routeWebSocket. The policy is off here, so the browser makes the
  // request and the recorder reports it; the foreign host is answered by the
  // test and a socket is never connected.
  test.use({ bypassCSP: true });

  test("the recorder sees a cross-origin fetch, and the checks fail on it", async ({
    baseURL,
    context,
    page,
  }) => {
    const origin = originOf(baseURL);
    const seen = await record(context);
    await answerForeign(context);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const target = `${FOREIGN}/leak`;
    const { sent } = await fetchForeign(page, target, SENTINELS.taxNumber);
    expect(sent, "the policy was not bypassed for this control").toBe(true);

    await expect
      .poll(() => seen.map((request) => request.url), {
        message: "the recorder missed a cross-origin fetch",
      })
      .toContain(target);
    const outside = offenders(
      seen,
      origin,
      builtPaths(),
      PERMITTED_FETCH_PATHS,
    );
    expect(outside.join("\n")).toContain(target);
    expect(leaks(seen, ALL_SENTINELS).join("\n")).toContain(target);
  });

  test("the recorder sees a cross-origin WebSocket, and the check fails on it", async ({
    baseURL,
    context,
    page,
  }) => {
    const origin = originOf(baseURL);
    const seen = await record(context);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const target = "ws://cross-origin.invalid/ws";
    await page.evaluate(async (url) => {
      const socket = new WebSocket(url);
      await new Promise<void>((resolve) => {
        socket.onclose = () => {
          resolve();
        };
        socket.onerror = () => {
          resolve();
        };
      });
    }, target);

    await expect
      .poll(() => seen.map((request) => request.url), {
        message: "the recorder missed a cross-origin WebSocket",
      })
      .toContain(target);
    const outside = offenders(
      seen,
      origin,
      builtPaths(),
      PERMITTED_FETCH_PATHS,
    );
    expect(outside.join("\n")).toContain(target);
  });
});

test("requests are judged by origin, and a fetch by its exact path", () => {
  const origin = "http://127.0.0.1:4174";
  const where = (url: string) => destination(url, origin);
  expect(where(`${origin}/assets/app.js`)).toBe("own-origin");
  expect(where("data:image/svg+xml,%3Csvg%3E")).toBe("local");
  expect(where(`blob:${origin}/6f1c`)).toBe("local");
  expect(where("blob:https://example.invalid/6f1c")).toBe("foreign");
  expect(where("https://cross-origin.invalid/leak")).toBe("foreign");
  expect(where("http://cross-origin.invalid/leak")).toBe("foreign");
  expect(where("http://127.0.0.1:4175/assets/app.js")).toBe("foreign");
  expect(where("https://127.0.0.1:4174/assets/app.js")).toBe("foreign");
  expect(where("ws://127.0.0.1:4174/socket")).toBe("foreign");
  expect(where("not a url")).toBe("foreign");

  // A stand-in path: the app publishes no snapshot to fetch yet.
  const path = "/example/snapshot.json";
  const allowed = (url: string) => isPermittedFetch(url, origin, [path]);
  expect(allowed(`${origin}${path}`)).toBe(true);
  expect(allowed(`${origin}${path}?isin=US0000000000`)).toBe(false);
  expect(allowed(`${origin}${path}/`)).toBe(false);
  expect(allowed(`${origin}${path}.map`)).toBe(false);
  expect(allowed(`${origin}/other${path}`)).toBe(false);
  expect(allowed(`${origin}/Example/snapshot.json`)).toBe(false);
  expect(allowed(`https://example.invalid${path}`)).toBe(false);
  expect(isPermittedFetch(`${origin}${path}`, origin, [])).toBe(false);
});

test("a built file is not a data fetch, whatever its type", () => {
  const origin = "http://127.0.0.1:4174";
  const built = builtPaths();
  const flagged = (url: string, method = "GET", type = "xhr") =>
    offenders(
      [{ url, method, resourceType: type, carried: "" }],
      origin,
      built,
      [],
    );
  const file = [...built].find((path) => /^\/assets\/.+\.js$/.test(path));
  if (file === undefined) throw new Error("the build holds no script chunk");
  const chunk = `${origin}${file}`;

  expect(built.has("/")).toBe(true);
  expect([...built].some((path) => ENGINE_BUNDLE.test(path))).toBe(true);

  // The shape WebKit reports for the worker's imports: a GET, typed xhr.
  expect(flagged(chunk)).toEqual([]);
  expect(flagged(chunk, "GET", "fetch")).toEqual([]);
  expect(flagged(chunk, "GET", "script")).toEqual([]);
  expect(flagged(`${origin}/`, "GET", "document")).toEqual([]);

  // Anything else, of any type, still fails.
  expect(flagged(`${origin}/assets/engine.worker-NoSuchHash.js`)).toHaveLength(
    1,
  );
  expect(
    flagged(`${origin}/assets/engine.worker-NoSuchHash.js`, "GET", "script"),
  ).toHaveLength(1);
  expect(flagged(`${origin}/api/rates`)).toHaveLength(1);
  expect(flagged(`${origin}/api/rates`, "GET", "image")).toHaveLength(1);
  expect(flagged(`${origin}/api/rates`, "POST", "beacon")).toHaveLength(1);
  expect(flagged(`${chunk}.map`)).toHaveLength(1);
  expect(flagged(`${origin}/other${file}`)).toHaveLength(1);
  expect(flagged(`${chunk}?isin=US0000000000`)).toHaveLength(1);
  expect(flagged(chunk, "POST")).toHaveLength(1);
  const foreign = flagged(`https://example.invalid${file}`);
  expect(foreign.join("\n")).toContain("leaves the app's origin");
  expect(
    flagged(`ws://127.0.0.1:4174${file}`, "GET", "websocket"),
  ).toHaveLength(1);
});
