/**
 * The guided tour's lines cross no text and no control (ADR 0016). Each stop of
 * the tour is laid out in a real browser, and every line the tour draws is
 * tested against every run of visible text and every control and picture on the
 * page: lit inside the card, or dimmed outside it.
 *
 * The obstacles are measured here, in the page, and deliberately not by
 * src/tour/obstacles.ts, which the app uses to route: a mistake in the app's
 * measuring must not hide itself from the test that checks its result.
 *
 * Chromium only, in three windows and both languages: the lines are geometry
 * the layout decides from sizes, and a longer Slovenian text makes a taller
 * explanation, which is where the lines first crossed things.
 */
import { expect, test, type Page } from "@playwright/test";

const DEMO = /Preizkusi demo|Explore the demo/;
const FINISH = /Končaj|Finish/;

interface Hit {
  readonly line: number;
  readonly what: string;
}

/** Lays out the tour's current stop, then reports the lines that cross something. */
async function crossings(page: Page): Promise<{
  readonly lines: number;
  readonly hits: readonly Hit[];
}> {
  // `place` runs in an animation frame after a scroll: let it finish.
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            done();
          });
        });
      }),
  );
  return page.evaluate(() => {
    interface Rect {
      left: number;
      top: number;
      right: number;
      bottom: number;
    }
    const dialog = document.querySelector("dialog.tour");
    if (dialog === null) throw new Error("no tour dialog");
    const numbers = (d: string) =>
      (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const lines = [...dialog.querySelectorAll("path.tour-line")].map((p) => {
      const n = numbers(p.getAttribute("d") ?? "");
      const points: [number, number][] = [];
      for (let i = 0; i + 1 < n.length; i += 2)
        points.push([n[i] ?? 0, n[i + 1] ?? 0]);
      return points;
    });

    // Only what a reader can see: not the tour, not what is hidden, and
    // nothing a scroll container has clipped away (a table scrolled sideways).
    const clip = (el: Element, r: Rect): Rect | null => {
      let { left, top, right, bottom } = r;
      for (
        let e: Element | null = el;
        e && e !== document.body;
        e = e.parentElement
      ) {
        const s = getComputedStyle(e);
        if (s.overflowX === "visible" && s.overflowY === "visible") continue;
        const c = e.getBoundingClientRect();
        left = Math.max(left, c.left);
        top = Math.max(top, c.top);
        right = Math.min(right, c.right);
        bottom = Math.min(bottom, c.bottom);
      }
      return right - left >= 1 && bottom - top >= 1
        ? { left, top, right, bottom }
        : null;
    };
    const gone = (el: Element) =>
      el.closest("[hidden], .visually-hidden, dialog.tour") !== null;
    const obstacles: { rect: Rect; what: string }[] = [];
    const add = (el: Element, r: DOMRect | DOMRectReadOnly, what: string) => {
      const shown = clip(el, r);
      if (shown !== null) obstacles.push({ rect: shown, what });
    };
    const words = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    for (let n = words.nextNode(); n; n = words.nextNode()) {
      const el = n.parentElement;
      if (el === null || gone(el) || (n.textContent ?? "").trim() === "")
        continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects())
        add(el, r, `text "${(n.textContent ?? "").trim().slice(0, 30)}"`);
    }
    const controls =
      "button, a[href], input, select, textarea, img, svg, [role=img], " +
      ".icon-tile, .note-icon, .chip, .delta, .ticker, .logo";
    for (const el of document.body.querySelectorAll(controls)) {
      if (gone(el)) continue;
      add(el, el.getBoundingClientRect(), `<${el.tagName.toLowerCase()}>`);
    }

    // Whether the segment passes through the inside of the rectangle.
    const through = (
      [x0, y0]: [number, number],
      [x1, y1]: [number, number],
      r: Rect,
    ) => {
      const m = 1.5; // touching an edge, or grazing it, is not crossing
      const [l, t, rt, b] = [r.left + m, r.top + m, r.right - m, r.bottom - m];
      if (rt <= l || b <= t) return false;
      if (x0 === x1)
        return (
          x0 > l && x0 < rt && Math.max(y0, y1) > t && Math.min(y0, y1) < b
        );
      if (y0 === y1)
        return (
          y0 > t && y0 < b && Math.max(x0, x1) > l && Math.min(x0, x1) < rt
        );
      return true;
    };
    const hits: { line: number; what: string }[] = [];
    lines.forEach((points, line) => {
      for (let k = 0; k + 1 < points.length; k += 1) {
        const a = points[k];
        const b = points[k + 1];
        if (a === undefined || b === undefined) continue;
        for (const o of obstacles)
          if (through(a, b, o.rect)) hits.push({ line, what: o.what });
      }
    });
    return { lines: lines.length, hits };
  });
}

/** Steps through the whole tour, collecting what each stop's lines cross. */
async function walk(page: Page): Promise<{
  readonly stops: number;
  readonly withoutLines: readonly number[];
  readonly problems: readonly string[];
}> {
  await page.goto("/");
  await page.getByRole("button", { name: DEMO }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const problems: string[] = [];
  const withoutLines: number[] = [];
  let stops = 0;
  for (let step = 0; step < 40; step += 1) {
    await expect(dialog).toHaveAttribute("data-ready", "true");
    const { lines, hits } = await crossings(page);
    stops += 1;
    if (lines === 0) withoutLines.push(step);
    for (const hit of hits.slice(0, 3))
      problems.push(
        `step ${String(step)}: line ${String(hit.line)} crosses ${hit.what}`,
      );
    const label = (await dialog.locator(".tour-next").textContent()) ?? "";
    await dialog.locator(".tour-next").click();
    if (FINISH.test(label)) break;
  }
  return { stops, withoutLines, problems };
}

const WINDOWS = [
  { locale: "sl-SI", width: 1440, height: 900 },
  { locale: "en-GB", width: 1280, height: 800 },
  { locale: "sl-SI", width: 1024, height: 768 },
] as const;

for (const { locale, width, height } of WINDOWS) {
  test.describe(`${locale} at ${String(width)}x${String(height)}`, () => {
    test.use({ locale, viewport: { width, height } });

    test("no line crosses text or a control, at any stop", async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== "chromium", "geometry, decided from sizes");
      const { stops, problems } = await walk(page);
      expect(stops).toBeGreaterThan(5);
      expect(problems).toEqual([]);
    });
  });
}

test.describe("in a wide window", () => {
  test.use({ locale: "sl-SI", viewport: { width: 1440, height: 900 } });

  test("every stop keeps its lines: none gives way to the sheet", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "geometry, decided from sizes");
    // A stop that falls back to the sheet (which has no line) is the price of a
    // line that cannot be drawn clear; in a window this wide nothing should
    // cost it, so a stop without lines means the content is measured as more
    // than it is, or a route was lost.
    const { withoutLines } = await walk(page);
    expect(withoutLines).toEqual([]);
  });
});
