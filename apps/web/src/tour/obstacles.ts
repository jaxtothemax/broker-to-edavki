/**
 * What a tour line must not cross (ADR 0016): every visible run of text, and
 * every control and picture, as rectangles in the window. The routes are
 * decided in layout.ts and route.ts, which only see these rectangles.
 *
 * Measured once when a stop has settled, and moved with the page as it
 * scrolls. The tour's own dialog is left out, and so is whatever a scroll
 * container hides: a table column scrolled out of view blocks nothing.
 */
import { intersect, type Box } from "./layout";

/**
 * Controls, pictures and the design system's small marks. Not containers: a
 * disclosure row (`summary`) or a card is the room its text and marks sit in,
 * and those are measured one by one, so a line may enter the room and cross
 * none of them.
 */
const CONTROLS =
  "button, a[href], input, select, textarea, img, svg, [role='img'], " +
  ".icon-tile, .note-icon, .chip, .delta, .ticker, .logo";

/**
 * Not on screen: hidden, read aloud only, the tour itself, or folded away in
 * a closed disclosure. Chromium keeps the last layout of a closed `<details>`
 * body, so a security unfolded at an earlier stop and folded again still
 * reports its rows where they were: text no one can see, which a line would
 * otherwise go round.
 */
const GONE =
  "[hidden], .visually-hidden, dialog.tour, details:not([open]) > :not(summary)";

/** Smaller than this is a hairline or a clip, not something to steer round. */
const LEAST = 2;

/**
 * The most obstacles taken in. The tour runs over the demo, a few hundred at a
 * time; a page with more than this is not one to steer lines across, so the
 * whole window counts as in the way, no line has a route, and the stop is
 * shown as the sheet.
 */
export const MAX_OBSTACLES = 6000;

const boxOf = (r: DOMRect): Box => ({
  left: r.left,
  top: r.top,
  width: r.width,
  height: r.height,
});

/** The visible part of what a scroll container shows, or null where none. */
function clipper() {
  const memo = new Map<Element, Box | null | undefined>();
  const clipOf = (element: Element | null): Box | null | undefined => {
    // undefined: nothing clips; null: everything is clipped away.
    if (element === null || element === document.body) return undefined;
    if (memo.has(element)) return memo.get(element);
    const above = clipOf(element.parentElement);
    const style = getComputedStyle(element);
    const clips = [style.overflowX, style.overflowY].some(
      (v) => v !== "visible",
    );
    let result: Box | null | undefined = above;
    if (clips && above !== null) {
      const own = boxOf(element.getBoundingClientRect());
      result = above === undefined ? own : intersect(own, above);
    }
    memo.set(element, result);
    return result;
  };
  return (element: Element, rect: Box): Box | null => {
    const clip = clipOf(element);
    if (clip === undefined) return rect;
    return clip === null ? null : intersect(rect, clip);
  };
}

/** Text and controls within a window's height or two of the view, in window pixels. */
export function measureObstacles(): readonly Box[] {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const near: Box = {
    left: -width,
    top: -1.5 * height,
    width: 3 * width,
    height: 4 * height,
  };
  const clip = clipper();
  const out: Box[] = [];
  const keep = (element: Element, rect: Box) => {
    if (rect.width < LEAST || rect.height < LEAST) return;
    const shown = clip(element, rect);
    if (shown === null || shown.width < LEAST || shown.height < LEAST) return;
    if (intersect(shown, near) !== null) out.push(shown);
  };

  const words = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = words.nextNode(); n !== null; n = words.nextNode()) {
    if ((n.textContent ?? "").trim() === "") continue;
    const parent = n.parentElement;
    if (parent === null || parent.closest(GONE) !== null) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const rect of range.getClientRects()) keep(parent, boxOf(rect));
  }

  for (const element of document.body.querySelectorAll(CONTROLS)) {
    if (element.closest(GONE) !== null) continue;
    keep(element, boxOf(element.getBoundingClientRect()));
  }

  // Marks drawn only by a background (a chart's bar, a dot): childless,
  // textless, painted, and not just a hairline.
  for (const element of document.body.querySelectorAll("*")) {
    if (element.children.length > 0 || element.textContent !== "") continue;
    if (element.matches(CONTROLS) || element.closest(GONE) !== null) continue;
    const rect = boxOf(element.getBoundingClientRect());
    if (rect.width < 3 || rect.height < 3) continue;
    const style = getComputedStyle(element);
    const painted =
      style.backgroundImage !== "none" ||
      !/^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$|^transparent$/.test(
        style.backgroundColor,
      );
    if (painted) keep(element, rect);
  }
  if (out.length > MAX_OBSTACLES) {
    return [{ left: 0, top: 0, width, height }];
  }
  return out;
}

/** The rectangles moved by (dx, dy): the page scrolled since they were measured. */
export function shifted(
  boxes: readonly Box[],
  dx: number,
  dy: number,
): readonly Box[] {
  if (dx === 0 && dy === 0) return boxes;
  return boxes.map((b) => ({ ...b, left: b.left + dx, top: b.top + dy }));
}
