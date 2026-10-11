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
 * the suite runs in. The policy is injected only by the production build, so
 * these run against `vite preview`, as playwright.config.ts does.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Made up for this test and planted in the input. Each is plain letters or
 * digits, so percent-encoding cannot hide it, and none can come from anything
 * the app legitimately requests (its asset names are hashes).
 */
const SENTINELS = {
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
 * (documents, modules, styles, fonts, images), which the origin check covers.
 */
const FETCH_TYPES: ReadonlySet<string> = new Set([
  "fetch",
  "xhr",
  "eventsource",
  "websocket",
  "ping",
]);

/**
 * The app's own built script chunks: the engine worker, and the bundled rate
 * tables it imports on first use (ADR 0005, ADR 0013 section 3). WebKit
 * reports a module a worker imports as an xhr, so the resource type cannot
 * tell such a load from a fetch of data; the address can. One folder, a .js
 * name with no further slash, anchored, so the pattern is linear.
 */
const BUILT_CHUNK_PATH = /^\/assets\/[\w.-]+\.js$/;

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

/** Records every request the context makes, from pages and workers alike. */
function record(context: BrowserContext): Seen[] {
  const seen: Seen[] = [];
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

/**
 * A plain GET of one of the app's own built chunks, from its own origin and
 * without a query: code the app ships, not data it fetches. A POST, a query
 * or any other folder or origin is not one, whatever type the browser gives.
 */
function isBuiltChunk(request: Seen, origin: string): boolean {
  const parsed = new URL(request.url);
  return (
    request.method === "GET" &&
    parsed.origin === origin &&
    parsed.search === "" &&
    BUILT_CHUNK_PATH.test(parsed.pathname)
  );
}

/** Every request that leaves the origin, or fetches what it may not. */
function offenders(
  seen: readonly Seen[],
  origin: string,
  permitted: readonly string[],
): string[] {
  return seen.flatMap((request) => {
    const where = destination(request.url, origin);
    const label = `${request.method} ${request.url} (${request.resourceType})`;
    if (where === "foreign") return [`${label} leaves the app's origin`];
    if (
      where === "own-origin" &&
      FETCH_TYPES.has(request.resourceType) &&
      !isBuiltChunk(request, origin) &&
      !isPermittedFetch(request.url, origin, permitted)
    ) {
      return [`${label} is a fetch other than the rate snapshot`];
    }
    return [];
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

test("an import to the results makes no outbound request", async ({
  baseURL,
  context,
  page,
}) => {
  const origin = originOf(baseURL);
  const seen = record(context);
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

  expect(offenders(seen, origin, PERMITTED_FETCH_PATHS)).toEqual([]);
  expect(leaks(seen, ALL_SENTINELS)).toEqual([]);
});

test("the built page's policy keeps connections to its own origin", async ({
  page,
}) => {
  await page.goto("/");
  const sources = await connectSources(page);
  expect(sources).toContain("'self'");
  // No wildcard and no whole scheme (https:, wss:) beside it.
  expect(sources.filter((s) => s === "*" || s.endsWith(":"))).toEqual([]);
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
  const seen = record(context);
  await page.goto("/");
  const probe = new URL("/probe-made-by-a-worker", origin).href;
  await fetchFromWorker(page, probe);
  await expect
    .poll(() => seen.map((request) => request.url), {
      message: "the recorder is blind to requests made by a worker",
    })
    .toContain(probe);
  // And a worker's fetch is not the rate snapshot, so the check fails on it.
  const outside = offenders(seen, origin, PERMITTED_FETCH_PATHS);
  expect(outside.join("\n")).toContain(probe);
});

test.describe("with the page's policy bypassed", () => {
  // A control: were the policy ever lost, the recorder is what would still
  // catch a leak. The policy is off here, so the browser sends the request
  // and every engine reports it; the foreign host is answered by the test.
  test.use({ bypassCSP: true });

  test("the recorder sees a cross-origin fetch, and the checks fail on it", async ({
    baseURL,
    context,
    page,
  }) => {
    const origin = originOf(baseURL);
    const seen = record(context);
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
    const outside = offenders(seen, origin, PERMITTED_FETCH_PATHS);
    expect(outside.join("\n")).toContain(target);
    expect(leaks(seen, ALL_SENTINELS).join("\n")).toContain(target);
  });
});

test("requests are judged by origin, and a fetch by its exact path", () => {
  const origin = "http://127.0.0.1:4174";
  const where = (url: string) => destination(url, origin);
  expect(where(`${origin}/assets/app.js`)).toBe("own-origin");
  expect(where("data:image/svg+xml,%3Csvg%3E")).toBe("local");
  expect(where(`blob:${origin}/6f1c`)).toBe("local");
  expect(where("blob:https://example.invalid/6f1c")).toBe("foreign");
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

test("a built script chunk is not a data fetch, whatever its type", () => {
  const origin = "http://127.0.0.1:4174";
  const flagged = (url: string, method = "GET", type = "xhr") =>
    offenders([{ url, method, resourceType: type, carried: "" }], origin, []);
  const file = "engine.worker-AbC123_x.js";
  const chunk = `${origin}/assets/${file}`;

  // The shape WebKit reports for the worker's imports: a GET, typed xhr.
  expect(flagged(chunk)).toEqual([]);
  expect(flagged(chunk, "GET", "fetch")).toEqual([]);
  expect(flagged(`${origin}/assets/bsi-daily-q9Z-0aB.js`)).toEqual([]);

  // Anything else a script starts still fails.
  expect(flagged(`${origin}/api/rates`)).toHaveLength(1);
  expect(flagged(`${origin}/assets/data.json`)).toHaveLength(1);
  expect(flagged(`${chunk}.map`)).toHaveLength(1);
  expect(flagged(`${origin}/other/${file}`)).toHaveLength(1);
  expect(flagged(`${origin}/assets/sub/${file}`)).toHaveLength(1);
  expect(flagged(`${chunk}?isin=US0000000000`)).toHaveLength(1);
  expect(flagged(chunk, "POST")).toHaveLength(1);
  const foreign = flagged(`https://example.invalid/assets/${file}`);
  expect(foreign.join("\n")).toContain("leaves the app's origin");
});
