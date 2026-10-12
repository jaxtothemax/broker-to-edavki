/**
 * The frame guard (#4) in a real browser. GitHub Pages cannot send
 * frame-ancestors, so another site can frame the published app; this proves
 * that the built app does not start in such a frame and says to open it in
 * its own tab instead (src/frameGuard.ts).
 *
 * The framing page comes from a small server on a port of its own, so the
 * frame is cross-origin, as another website's would be. It listens on
 * loopback only. No route is registered: no-outbound-requests.spec.ts explains
 * why a test that might start the engine worker must not, and a framed app
 * never gets that far.
 */
import { createServer } from "node:http";

import { expect, test } from "@playwright/test";

/** A page on another origin whose only content is a frame of `src`. */
async function withFramingPage(
  src: string,
  run: (url: string) => Promise<void>,
): Promise<void> {
  const page = [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><title>Another website</title></head>',
    `<body><iframe src="${src}" title="Framed page" width="1000" height="700"></iframe></body></html>`,
  ].join("\n");
  const server = createServer((_request, response) => {
    response
      .writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        connection: "close",
      })
      .end(page);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("the framing page has no port");
    }
    await run(`http://127.0.0.1:${String(address.port)}/`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
}

test("in another site's frame the app does not start, and links its own tab", async ({
  page,
  baseURL,
}) => {
  const app = new URL("/", baseURL).href;

  // The control: at the top of its tab, the same build starts.
  await page.goto(app);
  await expect(page.locator(".app")).toHaveCount(1);
  await expect(page.locator(".frame-guard")).toHaveCount(0);

  await withFramingPage(app, async (framing) => {
    await page.goto(framing);
    const frame = page.frameLocator("iframe");
    await expect(frame.locator(".frame-guard")).toBeVisible();
    await expect(
      frame.getByText(
        "TaxReporter does not start inside another website. Open it in its own tab to use it.",
      ),
    ).toBeVisible();
    await expect(frame.locator(".app")).toHaveCount(0);
    await expect(frame.locator("#main")).toHaveCount(0);
    const link = frame.getByRole("link", {
      name: "Open TaxReporter in its own tab",
    });
    await expect(link).toHaveAttribute("href", app);
    await expect(link).toHaveAttribute("target", "_top");
  });
});
