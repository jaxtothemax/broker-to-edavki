/**
 * Where a tour stop's explanations go, as pure geometry over measured
 * rectangles (ADR 0016). The component measures; these functions decide.
 *
 * Three presentations, tried in the stop's order of preference:
 * - "gutter": boxes beside the focus card, in the space between it and the
 *   window's edge, joined to their targets by horizontal lines;
 * - "row": boxes above and below the card, joined by vertical lines;
 * - "sheet": one explanation at a time inside the dock at the bottom, with a
 *   ring on its target and no line. Always on a phone, and wherever the
 *   others do not fit.
 *
 * Whether a presentation fits depends only on sizes (the window, the dock,
 * the card and every box of the stop), never on the scroll position, so it
 * cannot flip back and forth while the user scrolls. Placement then follows
 * the card wherever it is. A box never covers the card: boxes sit outside it.
 *
 * A line crosses no text and no control: where the straight way from a box to
 * its target's edge would, the line is routed through the free space between
 * them (route.ts), to a ring on whichever edge of the target it reaches. Where
 * there is no such way the line is left out and the placement says it is
 * `blocked`, so the stop is shown as the sheet instead of with a line through
 * the content. The component measures the text and controls; these functions
 * only see their rectangles.
 */

import { lineClear, route, type Dir, type End, type Route } from "./route";

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The window the dialog covers, and the bands nothing may cross. */
export interface Frame {
  readonly width: number;
  readonly height: number;
  /** The bottom of the app header: the focus card stays below it. */
  readonly headerBottom: number;
  /** The top of the dock: nothing is placed below it. */
  readonly dockTop: number;
}

export type Side = "left" | "right" | "above" | "below";
export type Point = readonly [number, number];

export interface Placed {
  readonly box: Box;
  readonly side: Side;
  /** From the box to the ring; null where the target is not in view. */
  readonly line: readonly Point[] | null;
  readonly ring: Point | null;
  /**
   * True where this presentation cannot show the explanation properly, so the
   * stop is shown another way: the box would leave the band between the
   * sticky header and the dock, or the target is in view but no line from the
   * box reaches it without crossing text or a control (the line and the ring
   * are then left out).
   */
  readonly blocked: boolean;
}

/** At this width and below (the phone breakpoint), one at a time. */
export const WIDE = 720;

export const SPACE = {
  /** Between the card and a gutter box. */
  gutter: 40,
  /** Between the card and a row of boxes. */
  row: 32,
  /** Between stacked gutter boxes. */
  stack: 12,
  /** Between boxes side by side in a row. */
  beside: 16,
  /** Kept free at the window's edges. */
  edge: 16,
  /** From a target's edge to its ring's center. */
  ring: 12,
  /** A line leaves a box at least this far from its corners. */
  inset: 16,
  /** Below the header, before the focus card. */
  header: 8,
} as const;

/** How far a line keeps from text and controls (px). */
export const CLEARANCE = {
  /** A line that already runs straight is kept if it clears by this much. */
  straight: 6,
  /** A routed line keeps this far from them where there is room for it... */
  comfortable: 8,
  /** ...and this far where there is not, so it never grazes a word. */
  routed: 4,
  /**
   * A ring needs this much room around its center: its halo is drawn 8px
   * out, so nothing may come nearer than that and a little air.
   */
  ring: 10,
  /**
   * Half the width of the band along the highlight's frame that a routed
   * line may cross but not run along.
   */
  frame: 10,
} as const;

export const BOX_WIDTH = { min: 240, max: 320, rowMin: 200 } as const;

export const right = (b: Box) => b.left + b.width;
export const bottom = (b: Box) => b.top + b.height;
export const centerX = (b: Box) => b.left + b.width / 2;
export const centerY = (b: Box) => b.top + b.height / 2;

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(low, high));

/** The box grown by `pad` on every side and kept inside the window. */
export function cutoutOf(focus: Box, pad: number, frame: Frame): Box {
  const left = Math.max(0, focus.left - pad);
  const top = Math.max(0, focus.top - pad);
  const r = Math.min(frame.width, right(focus) + pad);
  const b = Math.min(frame.height, bottom(focus) + pad);
  return {
    left,
    top,
    width: Math.max(0, r - left),
    height: Math.max(0, b - top),
  };
}

/** The box grown by `pad` on every side, wherever it is (for sizes). */
export function inflate(box: Box, pad: number): Box {
  return {
    left: box.left - pad,
    top: box.top - pad,
    width: box.width + 2 * pad,
    height: box.height + 2 * pad,
  };
}

/** The union of several boxes: a stop may light more than one element. */
export function union(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const r = Math.max(...boxes.map(right));
  const b = Math.max(...boxes.map(bottom));
  return { left, top, width: r - left, height: b - top };
}

/** The part of `box` inside `clip`, or null where they do not overlap. */
export function intersect(box: Box, clip: Box): Box | null {
  const left = Math.max(box.left, clip.left);
  const top = Math.max(box.top, clip.top);
  const r = Math.min(right(box), right(clip));
  const b = Math.min(bottom(box), bottom(clip));
  return r > left && b > top
    ? { left, top, width: r - left, height: b - top }
    : null;
}

/** Whether `inner` lies wholly inside `outer`. */
export function within(inner: Box, outer: Box): boolean {
  return (
    inner.left >= outer.left - 0.5 &&
    inner.top >= outer.top - 0.5 &&
    right(inner) <= right(outer) + 0.5 &&
    bottom(inner) <= bottom(outer) + 0.5
  );
}

/** The band boxes may use: between the sticky header and the dock. */
function boxBand(frame: Frame): {
  readonly top: number;
  readonly bottom: number;
} {
  return {
    top: Math.max(SPACE.edge, frame.headerBottom + SPACE.header),
    bottom: frame.dockTop - SPACE.edge,
  };
}

/**
 * Whether a box lies inside the band boxes may use. A box outside it is under
 * the sticky header or behind the dock: the presentation that put it there is
 * not used for the stop (`blocked`).
 */
function inBand(box: Box, frame: Frame): boolean {
  const band = boxBand(frame);
  return box.top >= band.top - 0.5 && bottom(box) <= band.bottom + 0.5;
}

/** The band the focus card must stay in: below the header, above the dock. */
export function cardBand(frame: Frame): {
  readonly top: number;
  readonly bottom: number;
} {
  return {
    top: frame.headerBottom + SPACE.header,
    bottom: frame.dockTop - SPACE.edge,
  };
}

// ─── Gutter ──────────────────────────────────────────────────────────────────

/** Box width in the gutters, or null where neither side has room. */
export function gutterWidth(frame: Frame, cutout: Box): number | null {
  const widths = [cutout.left, frame.width - right(cutout)]
    .filter((space) => space >= SPACE.gutter + BOX_WIDTH.min + SPACE.edge)
    .map((space) => Math.min(BOX_WIDTH.max, space - SPACE.gutter - SPACE.edge));
  return widths.length === 0 ? null : Math.floor(Math.min(...widths));
}

function gutterSides(
  frame: Frame,
  cutout: Box,
  targets: readonly (Box | null)[],
): readonly ("left" | "right")[] | null {
  const room = SPACE.gutter + BOX_WIDTH.min + SPACE.edge;
  const usable = {
    left: cutout.left >= room,
    right: frame.width - right(cutout) >= room,
  };
  if (!usable.left && !usable.right) return null;
  return targets.map((target) => {
    const x = target === null ? centerX(cutout) : centerX(target);
    const nearer = x - cutout.left <= right(cutout) - x ? "left" : "right";
    if (usable[nearer]) return nearer;
    return nearer === "left" ? "right" : "left";
  });
}

/** Whether the gutters hold every box of the stop, sizes only. */
export function gutterFits(
  frame: Frame,
  cutout: Box,
  targets: readonly (Box | null)[],
  heights: readonly number[],
): boolean {
  const band = cardBand(frame);
  if (cutout.height > band.bottom - band.top) return false;
  const sides = gutterSides(frame, cutout, targets);
  if (sides === null) return false;
  const room = boxBand(frame);
  for (const side of ["left", "right"] as const) {
    const stack = heights.filter((_, i) => sides[i] === side);
    const total =
      stack.reduce((sum, h) => sum + h, 0) +
      Math.max(0, stack.length - 1) * SPACE.stack;
    if (total > room.bottom - room.top) return false;
  }
  return true;
}

/** Places the boxes in the gutters, each beside its target as far as it can. */
export function placeGutter(
  frame: Frame,
  cutout: Box,
  targets: readonly (Box | null)[],
  heights: readonly number[],
  width: number,
  obstacles: readonly Box[] = [],
): readonly Placed[] {
  const sides =
    gutterSides(frame, cutout, targets) ?? targets.map(() => "right" as const);
  const band = boxBand(frame);
  const placed: { box: Box; side: "left" | "right" }[] = new Array<{
    box: Box;
    side: "left" | "right";
  }>(targets.length);
  for (const side of ["left", "right"] as const) {
    const order = targets
      .map((target, i) => ({
        i,
        y: target === null ? centerY(cutout) : centerY(target),
      }))
      .filter(({ i }) => sides[i] === side)
      .sort((a, b) => a.y - b.y);
    const tops: number[] = [];
    let floor = band.top;
    for (const { i, y } of order) {
      const h = heights[i] ?? 0;
      const top = Math.max(y - h / 2, floor);
      tops.push(top);
      floor = top + h + SPACE.stack;
    }
    // Pushed past the band at the bottom: move the whole stack up.
    const last = order.at(-1);
    if (last !== undefined) {
      const overflow =
        (tops.at(-1) ?? 0) + (heights[last.i] ?? 0) - band.bottom;
      if (overflow > 0) {
        for (let k = 0; k < tops.length; k += 1) {
          tops[k] = Math.max(band.top, (tops[k] ?? 0) - overflow);
        }
      }
    }
    order.forEach(({ i }, k) => {
      const box: Box = {
        left:
          side === "right"
            ? right(cutout) + SPACE.gutter
            : cutout.left - SPACE.gutter - width,
        top: tops[k] ?? band.top,
        width,
        height: heights[i] ?? 0,
      };
      placed[i] = { box, side };
    });
  }
  const room = lineRoom(frame);
  const boxes = placed.map((p) => p.box);
  const frameBands = alongFrame(cutout);
  return placed.map((p, i) => {
    const target = targets[i] ?? null;
    const line = joined(
      gutterLine(p.box, p.side, cutout, target),
      target === null ? null : gutterEnds(p.box, p.side, target),
      room,
      obstacles,
      boxes,
      i,
      frameBands,
    );
    return {
      ...p,
      ...line,
      blocked: line.blocked || !inBand(p.box, frame),
    };
  });
}

function gutterLine(
  box: Box,
  side: "left" | "right",
  cutout: Box,
  target: Box | null,
): Pick<Placed, "line" | "ring"> {
  if (target === null) return { line: null, ring: null };
  const y = centerY(target);
  const ring: Point = [
    side === "right" ? right(target) + SPACE.ring : target.left - SPACE.ring,
    y,
  ];
  const edge = side === "right" ? box.left : right(box);
  const leave = clamp(y, box.top + SPACE.inset, bottom(box) - SPACE.inset);
  if (Math.abs(leave - y) < 0.5) return { line: [[edge, y], ring], ring };
  const elbow =
    side === "right"
      ? right(cutout) + SPACE.gutter / 2
      : cutout.left - SPACE.gutter / 2;
  return { line: [[edge, leave], [elbow, leave], [elbow, y], ring], ring };
}

// ─── Row ─────────────────────────────────────────────────────────────────────

/** Box width in a row of `count` boxes, or null where they do not fit across. */
export function rowWidth(frame: Frame, count: number): number | null {
  const n = Math.max(1, count);
  const w = Math.min(
    BOX_WIDTH.max,
    (frame.width - 2 * SPACE.edge - (n - 1) * SPACE.beside) / n,
  );
  return w >= BOX_WIDTH.rowMin ? Math.floor(w) : null;
}

/** Which row each box goes in, before trying everything below or above. */
function rowSidesTried(
  frame: Frame,
  cutout: Box,
  targets: readonly (Box | null)[],
): readonly (readonly ("above" | "below")[])[] {
  const middle = centerY(cutout);
  const level = targets.every(
    (t) => t === null || Math.abs(centerY(t) - middle) <= 24,
  );
  const roomier =
    cutout.top - SPACE.edge >= frame.dockTop - SPACE.edge - bottom(cutout)
      ? "above"
      : "below";
  const natural = targets.map((t) =>
    level || t === null ? roomier : centerY(t) < middle ? "above" : "below",
  );
  return [
    natural,
    targets.map(() => "below" as const),
    targets.map(() => "above" as const),
  ];
}

/** The band the card must sit in for rows of these heights, by sizes only. */
export function rowCardBand(
  frame: Frame,
  sides: readonly ("above" | "below")[],
  heights: readonly number[],
): { readonly top: number; readonly bottom: number } {
  const tallest = (side: "above" | "below") =>
    Math.max(0, ...heights.filter((_, i) => sides[i] === side));
  const card = cardBand(frame);
  const above = sides.includes("above") ? tallest("above") + SPACE.row : 0;
  const below = sides.includes("below") ? tallest("below") + SPACE.row : 0;
  return {
    top: Math.max(card.top, boxBand(frame).top + above),
    bottom: card.bottom - below,
  };
}

/** The first row arrangement that holds every box of the stop, or null. */
export function rowFit(
  frame: Frame,
  cutout: Box,
  targets: readonly (Box | null)[],
  heights: readonly number[],
): readonly ("above" | "below")[] | null {
  if (rowWidth(frame, targets.length) === null) return null;
  for (const sides of rowSidesTried(frame, cutout, targets)) {
    const band = rowCardBand(frame, sides, heights);
    if (band.bottom - band.top >= cutout.height) return sides;
  }
  return null;
}

/** Places the boxes in rows above and below the card, each near its target. */
export function placeRow(
  frame: Frame,
  cutout: Box,
  targets: readonly (Box | null)[],
  heights: readonly number[],
  width: number,
  sides: readonly ("above" | "below")[],
  obstacles: readonly Box[] = [],
): readonly Placed[] {
  const placed: { box: Box; side: "above" | "below" }[] = new Array<{
    box: Box;
    side: "above" | "below";
  }>(targets.length);
  for (const side of ["above", "below"] as const) {
    const order = targets
      .map((target, i) => ({
        i,
        x: target === null ? centerX(cutout) : centerX(target),
      }))
      .filter(({ i }) => sides[i] === side)
      .sort((a, b) => a.x - b.x);
    const lefts: number[] = [];
    let floor = SPACE.edge;
    for (const { x } of order) {
      const left = Math.max(x - width / 2, floor);
      lefts.push(left);
      floor = left + width + SPACE.beside;
    }
    const overflow = (lefts.at(-1) ?? 0) + width - (frame.width - SPACE.edge);
    if (overflow > 0) {
      for (let k = 0; k < lefts.length; k += 1) {
        lefts[k] = Math.max(SPACE.edge, (lefts[k] ?? 0) - overflow);
      }
    }
    order.forEach(({ i }, k) => {
      const h = heights[i] ?? 0;
      const box: Box = {
        left: lefts[k] ?? SPACE.edge,
        top:
          side === "above"
            ? cutout.top - SPACE.row - h
            : bottom(cutout) + SPACE.row,
        width,
        height: h,
      };
      placed[i] = { box, side };
    });
  }
  const room = lineRoom(frame);
  const boxes = placed.map((p) => p.box);
  const frameBands = alongFrame(cutout);
  return placed.map((p, i) => {
    const target = targets[i] ?? null;
    const line = joined(
      rowLine(p.box, p.side, cutout, target),
      target === null ? null : rowEnds(p.box, p.side, target),
      room,
      obstacles,
      boxes,
      i,
      frameBands,
    );
    // A box above the card is not held below the header (nor one below it
    // above the dock): the card's place decides the box's, so a card scrolled
    // near an edge would push its row out of the band.
    return {
      ...p,
      ...line,
      blocked: line.blocked || !inBand(p.box, frame),
    };
  });
}

function rowLine(
  box: Box,
  side: "above" | "below",
  cutout: Box,
  target: Box | null,
): Pick<Placed, "line" | "ring"> {
  if (target === null) return { line: null, ring: null };
  const x = centerX(target);
  const ring: Point = [
    x,
    side === "above" ? target.top - SPACE.ring : bottom(target) + SPACE.ring,
  ];
  const edge = side === "above" ? bottom(box) : box.top;
  const leave = clamp(x, box.left + SPACE.inset, right(box) - SPACE.inset);
  if (Math.abs(leave - x) < 0.5) return { line: [[x, edge], ring], ring };
  const elbow =
    side === "above"
      ? cutout.top - SPACE.row / 2
      : bottom(cutout) + SPACE.row / 2;
  return { line: [[leave, edge], [leave, elbow], [x, elbow], ring], ring };
}

// ─── Keeping lines off the content ───────────────────────────────────────────

/** The room a line may use: the window between the header and the dock. */
function lineRoom(frame: Frame): Box {
  const band = boxBand(frame);
  return {
    left: SPACE.edge,
    top: band.top,
    width: Math.max(0, frame.width - 2 * SPACE.edge),
    height: Math.max(0, band.bottom - band.top),
  };
}

/** What is left of `piece` when `cover` is taken out of it (up to four boxes). */
function without(piece: Box, cover: Box): readonly Box[] {
  const shared = intersect(piece, cover);
  if (shared === null) return [piece];
  const parts: Box[] = [
    // Left and right of the covered part, over the piece's whole height.
    {
      left: piece.left,
      top: piece.top,
      width: shared.left - piece.left,
      height: piece.height,
    },
    {
      left: right(shared),
      top: piece.top,
      width: right(piece) - right(shared),
      height: piece.height,
    },
    // Above and below it, across the covered part's width.
    {
      left: shared.left,
      top: piece.top,
      width: shared.width,
      height: shared.top - piece.top,
    },
    {
      left: shared.left,
      top: bottom(shared),
      width: shared.width,
      height: bottom(piece) - bottom(shared),
    },
  ];
  return parts.filter((p) => p.width >= 0.5 && p.height >= 0.5);
}

/**
 * The text and controls as an explanation box leaves them in view: what lies
 * wholly under a box is gone, and one that peeks out from under it keeps only
 * the part in view, so a line never crosses what shows and never starts inside
 * what is hidden.
 */
function uncovered(
  obstacles: readonly Box[],
  boxes: readonly Box[],
): readonly Box[] {
  return obstacles.flatMap((o) =>
    boxes.reduce<readonly Box[]>(
      (pieces, cover) => pieces.flatMap((p) => without(p, cover)),
      [o],
    ),
  );
}

/**
 * Thin bands over the highlight's frame, one per edge: a routed line may
 * cross the frame but not run along it, where it would read as part of it.
 */
function alongFrame(cutout: Box): readonly Box[] {
  const t = CLEARANCE.frame;
  if (cutout.width <= 0 || cutout.height <= 0) return [];
  return [
    {
      left: cutout.left,
      top: cutout.top - t,
      width: cutout.width,
      height: 2 * t,
    },
    {
      left: cutout.left,
      top: bottom(cutout) - t,
      width: cutout.width,
      height: 2 * t,
    },
    {
      left: cutout.left - t,
      top: cutout.top,
      width: 2 * t,
      height: cutout.height,
    },
    {
      left: right(cutout) - t,
      top: cutout.top,
      width: 2 * t,
      height: cutout.height,
    },
  ];
}

/** Whether the ring has room around its center. */
function ringClear(ring: Point | null, obstacles: readonly Box[]): boolean {
  if (ring === null) return true;
  return !obstacles.some(
    (o) =>
      ring[0] > o.left - CLEARANCE.ring &&
      ring[0] < right(o) + CLEARANCE.ring &&
      ring[1] > o.top - CLEARANCE.ring &&
      ring[1] < bottom(o) + CLEARANCE.ring,
  );
}

/**
 * The line as the layout first draws it, when it crosses nothing; otherwise
 * the cheapest route through the free space to a ring on any edge of the
 * target; otherwise no line, and `blocked`. The other explanation boxes count
 * as things to keep clear of, and so do the text and controls an explanation
 * box does not hide.
 */
function joined(
  straight: Pick<Placed, "line" | "ring">,
  ends: {
    readonly starts: readonly End[];
    readonly rings: readonly End[];
  } | null,
  room: Box,
  obstacles: readonly Box[],
  boxes: readonly Box[],
  own: number,
  frameBands: readonly Box[] = [],
): Pick<Placed, "line" | "ring" | "blocked"> {
  if (straight.line === null || ends === null)
    return { ...straight, blocked: false };
  const keepClear = [
    ...uncovered(obstacles, boxes),
    ...boxes.filter((_, k) => k !== own),
  ];
  if (
    keepClear.length === 0 ||
    (lineClear(straight.line, keepClear, CLEARANCE.straight) &&
      ringClear(straight.ring, keepClear))
  )
    return { ...straight, blocked: false };
  // As much room as there is: the comfortable distance, else the tight one.
  let found: Route | null = null;
  for (const clearance of [CLEARANCE.comfortable, CLEARANCE.routed]) {
    found = route({
      bounds: room,
      obstacles: keepClear,
      clearance,
      starts: ends.starts,
      rings: ends.rings,
      ringClearance: CLEARANCE.ring,
      along: frameBands,
    });
    if (found !== null) break;
  }
  return found === null
    ? { line: null, ring: null, blocked: true }
    : { line: found.line, ring: found.ring, blocked: false };
}

/** Where a line may leave a gutter box: its edge toward the card. */
function gutterEnds(box: Box, side: "left" | "right", target: Box) {
  const x = side === "right" ? box.left : right(box);
  const low = box.top + SPACE.inset;
  const high = Math.max(low, bottom(box) - SPACE.inset);
  const start: End = {
    a: [x, low],
    b: [x, high],
    dir: side === "right" ? 2 : 0,
    base: 0,
    prefer: clamp(centerY(target), low, high),
  };
  return {
    starts: [start],
    rings: ringsAround(target, side, [x, centerY(box)]),
  };
}

/** Where a line may leave a row box: its edge toward the card. */
function rowEnds(box: Box, side: "above" | "below", target: Box) {
  const y = side === "below" ? box.top : bottom(box);
  const low = box.left + SPACE.inset;
  const high = Math.max(low, right(box) - SPACE.inset);
  const start: End = {
    a: [low, y],
    b: [high, y],
    dir: side === "below" ? 3 : 1,
    base: 0,
    prefer: clamp(centerX(target), low, high),
  };
  return {
    starts: [start],
    rings: ringsAround(target, side === "below" ? "bottom" : "top", [
      centerX(box),
      y,
    ]),
  };
}

/**
 * Where the ring may sit: just outside any edge of the target, the one facing
 * the box at no extra cost (centered), the others at a price and as near the
 * box as they go. The line arrives squarely, toward the target.
 */
function ringsAround(
  target: Box,
  facing: "left" | "right" | "top" | "bottom",
  from: Point,
): End[] {
  const gap = SPACE.ring;
  const inset = 4;
  const span = (low: number, high: number): [number, number] =>
    high - low > 2 * inset
      ? [low + inset, high - inset]
      : [(low + high) / 2, (low + high) / 2];
  const [x0, x1] = span(target.left, right(target));
  const [y0, y1] = span(target.top, bottom(target));
  const opposite = {
    left: "right",
    right: "left",
    top: "bottom",
    bottom: "top",
  } as const;
  const edges: readonly {
    edge: "left" | "right" | "top" | "bottom";
    a: Point;
    b: Point;
    dir: Dir;
    middle: number;
    near: number;
    low: number;
    high: number;
  }[] = [
    {
      edge: "right",
      a: [right(target) + gap, y0],
      b: [right(target) + gap, y1],
      dir: 2,
      middle: centerY(target),
      near: from[1],
      low: y0,
      high: y1,
    },
    {
      edge: "left",
      a: [target.left - gap, y0],
      b: [target.left - gap, y1],
      dir: 0,
      middle: centerY(target),
      near: from[1],
      low: y0,
      high: y1,
    },
    {
      edge: "bottom",
      a: [x0, bottom(target) + gap],
      b: [x1, bottom(target) + gap],
      dir: 3,
      middle: centerX(target),
      near: from[0],
      low: x0,
      high: x1,
    },
    {
      edge: "top",
      a: [x0, target.top - gap],
      b: [x1, target.top - gap],
      dir: 1,
      middle: centerX(target),
      near: from[0],
      low: x0,
      high: x1,
    },
  ];
  return edges.map((e) => ({
    a: e.a,
    b: e.b,
    dir: e.dir,
    base: e.edge === facing ? 0 : e.edge === opposite[facing] ? 90 : 40,
    prefer: e.edge === facing ? e.middle : clamp(e.near, e.low, e.high),
  }));
}

// ─── The sheet's ring ────────────────────────────────────────────────────────

/** Whether a point lies on the highlight's frame, within a ring's room of it. */
function onFrame(point: Point, cutout: Box | null): boolean {
  if (cutout === null) return false;
  const room = CLEARANCE.ring;
  const [x, y] = point;
  const near = (v: number, edge: number) => Math.abs(v - edge) < room;
  const acrossX = x > cutout.left - room && x < right(cutout) + room;
  const acrossY = y > cutout.top - room && y < bottom(cutout) + room;
  return (
    (acrossX && (near(y, cutout.top) || near(y, bottom(cutout)))) ||
    (acrossY && (near(x, cutout.left) || near(x, right(cutout))))
  );
}

/**
 * Where the sheet puts its ring: beside the target on the first side, of
 * left, right, above and below, where it is in the window, has its room
 * clear of text and controls, and does not sit on the highlight's frame.
 * Where no side has all that, the first side in the window, as before: the
 * sheet has no line, so the ring is the only mark on the target.
 */
export function placeSheetRing(
  target: Box,
  frame: Frame,
  cutout: Box | null,
  obstacles: readonly Box[],
): Point | null {
  const gap = SPACE.ring;
  const sides: readonly Point[] = [
    [target.left - gap, centerY(target)],
    [right(target) + gap, centerY(target)],
    [centerX(target), target.top - gap],
    [centerX(target), bottom(target) + gap],
  ];
  const inWindow = ([x, y]: Point) =>
    x >= gap &&
    x <= frame.width - gap &&
    y >= frame.headerBottom + gap &&
    y <= frame.dockTop - gap;
  const shown = sides.filter(inWindow);
  return (
    shown.find((p) => ringClear(p, obstacles) && !onFrame(p, cutout)) ??
    shown[0] ??
    null
  );
}

// ─── Choosing, scrolling, drawing ────────────────────────────────────────────

export type Presentation =
  | { readonly mode: "gutter"; readonly width: number }
  | {
      readonly mode: "row";
      readonly width: number;
      readonly sides: readonly ("above" | "below")[];
    }
  | { readonly mode: "sheet" };

/**
 * The stop's presentation, from the sizes of the window, the card and every
 * box (heights at the gutter and the row width). A phone always gets the sheet.
 */
export function choose(
  frame: Frame,
  cutout: Box,
  targets: readonly (Box | null)[],
  heights: {
    readonly gutter: readonly number[];
    readonly row: readonly number[];
  },
  prefer: "gutter" | "row",
  /** A phone's window, as the stylesheet's media query sees it. */
  phone: boolean = frame.width <= WIDE,
  /**
   * Whether every line of a presentation that fits can be drawn without
   * crossing text or a control; one that cannot is skipped, and the sheet,
   * which has no line, is what is left. Measured once when the stop settles,
   * so what is shown does not change as the page scrolls.
   */
  linesClear: (presentation: Presentation) => boolean = () => true,
): Presentation {
  if (phone) return { mode: "sheet" };
  const tryGutter = (): Presentation | null => {
    const width = gutterWidth(frame, cutout);
    return width !== null && gutterFits(frame, cutout, targets, heights.gutter)
      ? { mode: "gutter", width }
      : null;
  };
  const tryRow = (): Presentation | null => {
    const width = rowWidth(frame, targets.length);
    const sides = rowFit(frame, cutout, targets, heights.row);
    return width !== null && sides !== null
      ? { mode: "row", width, sides }
      : null;
  };
  const order = prefer === "gutter" ? [tryGutter, tryRow] : [tryRow, tryGutter];
  for (const attempt of order) {
    const found = attempt();
    if (found !== null && linesClear(found)) return found;
  }
  return { mode: "sheet" };
}

/**
 * How far to scroll the window so `subject` sits in the middle of `band`, or
 * its top at the band's top where it is taller than the band.
 */
export function scrollDelta(
  subject: Box,
  band: { readonly top: number; readonly bottom: number },
): number {
  const height = band.bottom - band.top;
  if (subject.height > height) return subject.top - band.top;
  return centerY(subject) - (band.top + height / 2);
}

/**
 * The scrollLeft that centers `target` in a sideways scroller, or null where
 * the target is already wholly in view. What scrolls is the padding box
 * (`clientLeft` past the border box's edge, `clientWidth` wide): measuring
 * against the border box would stop a bordered table short of its last column.
 */
export function scrollLeftFor(
  scroller: {
    readonly box: Box;
    readonly clientLeft: number;
    readonly clientWidth: number;
    readonly scrollLeft: number;
    readonly scrollWidth: number;
  },
  target: Box,
): number | null {
  const view: Box = {
    ...scroller.box,
    left: scroller.box.left + scroller.clientLeft,
    width: scroller.clientWidth,
  };
  if (target.left >= view.left && right(target) <= right(view)) return null;
  const wanted = scroller.scrollLeft + centerX(target) - centerX(view);
  return clamp(
    Math.round(wanted),
    0,
    Math.max(0, scroller.scrollWidth - scroller.clientWidth),
  );
}

/** An SVG path for a rectangle with rounded corners. */
export function roundedRect(box: Box, radius: number): string {
  const r = Math.max(0, Math.min(radius, box.width / 2, box.height / 2));
  const x = box.left;
  const y = box.top;
  const w = box.width;
  const h = box.height;
  const n = (v: number) => String(Math.round(v * 100) / 100);
  return [
    `M${n(x + r)} ${n(y)}`,
    `H${n(x + w - r)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(x + w)} ${n(y + r)}`,
    `V${n(y + h - r)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(x + w - r)} ${n(y + h)}`,
    `H${n(x + r)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(y + h - r)}`,
    `V${n(y + r)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}`,
    "Z",
  ].join(" ");
}

/** The dim: the whole window with the cutout left open (even-odd). */
export function dimPath(
  frame: Frame,
  cutout: Box | null,
  radius: number,
): string {
  const outer = `M0 0H${String(frame.width)}V${String(frame.height)}H0Z`;
  return cutout === null ? outer : `${outer} ${roundedRect(cutout, radius)}`;
}

/** An SVG path through `points`. */
export function linePath(points: readonly Point[]): string {
  return points
    .map(
      ([x, y], i) =>
        `${i === 0 ? "M" : "L"}${String(Math.round(x * 100) / 100)} ${String(Math.round(y * 100) / 100)}`,
    )
    .join(" ");
}
