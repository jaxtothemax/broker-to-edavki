/**
 * Routes for the tour's lines (ADR 0016), as pure geometry over measured
 * rectangles: from an explanation box to a ring beside its target, through the
 * free space between the text and the controls of the page, never across them.
 *
 * Lines are orthogonal, so the free space is a grid: the lines through every
 * obstacle's edges (grown by the clearance) and through the ends of the line.
 * A shortest-path search over that grid, with a price on every bend, finds the
 * route; where none exists the caller shows the explanation without a line (the
 * sheet), never a line through the content.
 *
 * Nothing here reads the page: the component measures, these functions decide.
 */
import type { Box, Point } from "./layout";

/** Directions of travel: right, down, left, up. */
export type Dir = 0 | 1 | 2 | 3;

const DX = [1, 0, -1, 0] as const;
const DY = [0, 1, 0, -1] as const;

/**
 * Where a line may start (on its box's edge) or finish (the ring beside its
 * target): an axis-aligned segment, the way the line travels at that end, and
 * what that choice costs.
 */
export interface End {
  readonly a: Point;
  readonly b: Point;
  /**
   * For a start, the direction the line leaves the box; for a ring, the
   * direction it arrives at it. A line meets a box and a target squarely.
   */
  readonly dir: Dir;
  /** Added to the cost of using this segment at all. */
  readonly base: number;
  /** The coordinate along the segment that costs nothing to use. */
  readonly prefer: number;
}

export interface RouteInput {
  /** The room the line may use. */
  readonly bounds: Box;
  /** Text and controls: the line keeps `clearance` away from each. */
  readonly obstacles: readonly Box[];
  readonly clearance: number;
  readonly starts: readonly End[];
  readonly rings: readonly End[];
  /** The ring's own room: no obstacle comes closer to its center than this. */
  readonly ringClearance: number;
}

export interface Route {
  readonly line: readonly Point[];
  readonly ring: Point;
}

/** What a bend costs, in pixels of line. */
const BEND = 24;
/**
 * The most grid nodes a search may build. The page the tour runs over is the
 * demo's, a few hundred obstacles and about 100,000 nodes; past this there is
 * no route rather than a tab that stops answering.
 */
export const MAX_NODES = 500_000;
/** Of a segment's length, the part not used for a start or a ring. */
const OFF_CENTER = 0.35;

const same = (a: number, b: number) => Math.abs(a - b) < 0.01;

/** Sorted, de-duplicated values. */
function axis(values: readonly number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const unique: number[] = [];
  for (const v of sorted) {
    const last = unique.at(-1);
    if (last === undefined || !same(last, v)) unique.push(v);
  }
  return unique;
}

const indexOf = (values: readonly number[], v: number) => {
  let low = 0;
  let high = values.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const m = values[mid] ?? 0;
    if (same(m, v)) return mid;
    if (m < v) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
};

/** Whether the segment passes through the inside of the box (touching is clear). */
function crosses(a: Point, b: Point, box: Box): boolean {
  const left = box.left;
  const right = box.left + box.width;
  const top = box.top;
  const bottom = box.top + box.height;
  if (right - left <= 0 || bottom - top <= 0) return false;
  const [x0, y0] = a;
  const [x1, y1] = b;
  if (same(x0, x1)) {
    return (
      x0 > left + 0.01 &&
      x0 < right - 0.01 &&
      Math.max(y0, y1) > top + 0.01 &&
      Math.min(y0, y1) < bottom - 0.01
    );
  }
  if (same(y0, y1)) {
    return (
      y0 > top + 0.01 &&
      y0 < bottom - 0.01 &&
      Math.max(x0, x1) > left + 0.01 &&
      Math.min(x0, x1) < right - 0.01
    );
  }
  return true; // lines here are orthogonal; a slanted one is never clear
}

const grow = (box: Box, by: number): Box => ({
  left: box.left - by,
  top: box.top - by,
  width: box.width + 2 * by,
  height: box.height + 2 * by,
});

/** Whether a polyline keeps `clearance` away from every obstacle. */
export function lineClear(
  line: readonly Point[],
  obstacles: readonly Box[],
  clearance: number,
): boolean {
  const grown = obstacles.map((o) => grow(o, clearance));
  for (let k = 0; k + 1 < line.length; k += 1) {
    const a = line[k];
    const b = line[k + 1];
    if (a === undefined || b === undefined) continue;
    if (grown.some((o) => crosses(a, b, o))) return false;
  }
  return true;
}

/** A binary min-heap of [cost, state] pairs, state -1 - n marking a finish. */
class Heap {
  private readonly costs: number[] = [];
  private readonly items: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(cost: number, item: number): void {
    let k = this.items.length;
    this.costs.push(cost);
    this.items.push(item);
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if ((this.costs[parent] ?? 0) <= cost) break;
      this.costs[k] = this.costs[parent] ?? 0;
      this.items[k] = this.items[parent] ?? 0;
      k = parent;
    }
    this.costs[k] = cost;
    this.items[k] = item;
  }

  pop(): [number, number] {
    const top: [number, number] = [this.costs[0] ?? 0, this.items[0] ?? 0];
    const cost = this.costs.pop() ?? 0;
    const item = this.items.pop() ?? 0;
    const n = this.items.length;
    if (n > 0) {
      let k = 0;
      for (;;) {
        let child = 2 * k + 1;
        if (child >= n) break;
        if (
          child + 1 < n &&
          (this.costs[child + 1] ?? 0) < (this.costs[child] ?? 0)
        )
          child += 1;
        if ((this.costs[child] ?? 0) >= cost) break;
        this.costs[k] = this.costs[child] ?? 0;
        this.items[k] = this.items[child] ?? 0;
        k = child;
      }
      this.costs[k] = cost;
      this.items[k] = item;
    }
    return top;
  }
}

/** The grid nodes along an end's segment, each with its price. */
function along(
  end: End,
  xs: readonly number[],
  ys: readonly number[],
): { i: number; j: number; price: number }[] {
  const out: { i: number; j: number; price: number }[] = [];
  const horizontal = !same(end.a[0], end.b[0]);
  if (horizontal) {
    const j = indexOf(ys, end.a[1]);
    if (j < 0) return out;
    const low = Math.min(end.a[0], end.b[0]);
    const high = Math.max(end.a[0], end.b[0]);
    xs.forEach((x, i) => {
      if (x < low - 0.01 || x > high + 0.01) return;
      out.push({
        i,
        j,
        price: end.base + Math.abs(x - end.prefer) * OFF_CENTER,
      });
    });
    return out;
  }
  const i = indexOf(xs, end.a[0]);
  if (i < 0) return out;
  const low = Math.min(end.a[1], end.b[1]);
  const high = Math.max(end.a[1], end.b[1]);
  ys.forEach((y, j) => {
    if (y < low - 0.01 || y > high + 0.01) return;
    out.push({ i, j, price: end.base + Math.abs(y - end.prefer) * OFF_CENTER });
  });
  return out;
}

/**
 * The cheapest route from any start to any ring that keeps clear of the
 * obstacles, or null where there is none. Cost is the line's length, a price
 * per bend, and what the chosen start and ring cost.
 */
export function route(input: RouteInput): Route | null {
  const { bounds, clearance } = input;
  const room: Box = bounds;
  const roomRight = room.left + room.width;
  const roomBottom = room.top + room.height;
  const grown = input.obstacles
    .map((o) => grow(o, clearance))
    .filter(
      (o) =>
        o.left < roomRight &&
        o.left + o.width > room.left &&
        o.top < roomBottom &&
        o.top + o.height > room.top,
    );

  const xValues: number[] = [room.left, roomRight];
  const yValues: number[] = [room.top, roomBottom];
  // An edge of a grown obstacle lies on the grid where it is inside the room.
  for (const o of grown) {
    for (const x of [o.left, o.left + o.width])
      if (x >= room.left && x <= roomRight) xValues.push(x);
    for (const y of [o.top, o.top + o.height])
      if (y >= room.top && y <= roomBottom) yValues.push(y);
  }
  // Each end's coordinates, and the one along it that costs nothing, so a line
  // can run exactly where the layout would put it.
  for (const end of [...input.starts, ...input.rings]) {
    xValues.push(end.a[0], end.b[0]);
    yValues.push(end.a[1], end.b[1]);
    if (same(end.a[0], end.b[0])) {
      yValues.push(
        Math.min(
          Math.max(end.prefer, Math.min(end.a[1], end.b[1])),
          Math.max(end.a[1], end.b[1]),
        ),
      );
    } else {
      xValues.push(
        Math.min(
          Math.max(end.prefer, Math.min(end.a[0], end.b[0])),
          Math.max(end.a[0], end.b[0]),
        ),
      );
    }
  }
  const xs = axis(xValues.filter((x) => x >= room.left && x <= roomRight));
  const ys = axis(yValues.filter((y) => y >= room.top && y <= roomBottom));
  const nx = xs.length;
  const ny = ys.length;
  if (nx < 2 || ny < 2 || nx * ny > MAX_NODES) return null;

  // Blocked nodes and edges: those strictly inside a grown obstacle.
  const nodeBlocked = new Uint8Array(nx * ny);
  const edgeBlocked = new Uint8Array(nx * ny * 2); // [node * 2 + (0: right, 1: down)]
  // Where an obstacle runs past the room, its edge is off the grid (index -1
  // or past the last): the room's own border is inside it, not a way round.
  const edgeIndex = (
    v: number,
    values: readonly number[],
    low: number,
    high: number,
  ) =>
    v < low - 0.01 ? -1 : v > high + 0.01 ? values.length : indexOf(values, v);
  for (const o of grown) {
    const i0 = edgeIndex(o.left, xs, room.left, roomRight);
    const i1 = edgeIndex(o.left + o.width, xs, room.left, roomRight);
    const j0 = edgeIndex(o.top, ys, room.top, roomBottom);
    const j1 = edgeIndex(o.top + o.height, ys, room.top, roomBottom);
    for (let j = Math.max(j0, 0); j <= Math.min(j1, ny - 1); j += 1) {
      for (let i = Math.max(i0, 0); i <= Math.min(i1, nx - 1); i += 1) {
        const inside = i > i0 && i < i1 && j > j0 && j < j1;
        if (inside) nodeBlocked[j * nx + i] = 1;
        // The edge to the right runs through the inside along rows j0 < j < j1.
        if (i < i1 && j > j0 && j < j1) edgeBlocked[(j * nx + i) * 2] = 1;
        // The edge down runs through the inside along columns i0 < i < i1.
        if (j < j1 && i > i0 && i < i1) edgeBlocked[(j * nx + i) * 2 + 1] = 1;
      }
    }
  }

  const ringFree = (x: number, y: number) =>
    !input.obstacles.some(
      (o) =>
        x > o.left - input.ringClearance &&
        x < o.left + o.width + input.ringClearance &&
        y > o.top - input.ringClearance &&
        y < o.top + o.height + input.ringClearance,
    );

  // Finishes: a state (node, arriving direction) and what ending there costs.
  const finish = new Map<number, number>();
  for (const end of input.rings) {
    for (const { i, j, price } of along(end, xs, ys)) {
      const node = j * nx + i;
      if (nodeBlocked[node] === 1) continue;
      if (!ringFree(xs[i] ?? 0, ys[j] ?? 0)) continue;
      const state = node * 4 + end.dir;
      finish.set(state, Math.min(finish.get(state) ?? Infinity, price));
    }
  }
  if (finish.size === 0) return null;

  const states = nx * ny * 4;
  const dist = new Float64Array(states).fill(Infinity);
  const parent = new Int32Array(states).fill(-1);
  const startPoint = new Map<number, Point>();
  const heap = new Heap();

  const edgeOpen = (i: number, j: number, d: Dir): boolean => {
    const ni = i + DX[d];
    const nj = j + DY[d];
    if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) return false;
    if (nodeBlocked[nj * nx + ni] === 1) return false;
    // The edge between two nodes is stored at its left or upper node.
    const lowI = Math.min(i, ni);
    const lowJ = Math.min(j, nj);
    return edgeBlocked[(lowJ * nx + lowI) * 2 + (d % 2)] !== 1;
  };

  // A line leaves its box squarely: the first step is along `dir`.
  for (const end of input.starts) {
    for (const { i, j, price } of along(end, xs, ys)) {
      if (nodeBlocked[j * nx + i] === 1) continue;
      if (!edgeOpen(i, j, end.dir)) continue;
      const ni = i + DX[end.dir];
      const nj = j + DY[end.dir];
      const length = Math.abs(
        (xs[ni] ?? 0) - (xs[i] ?? 0) + (ys[nj] ?? 0) - (ys[j] ?? 0),
      );
      const state = (nj * nx + ni) * 4 + end.dir;
      const cost = price + length;
      if (cost < (dist[state] ?? Infinity)) {
        dist[state] = cost;
        parent[state] = -1;
        startPoint.set(state, [xs[i] ?? 0, ys[j] ?? 0]);
        heap.push(cost, state);
      }
    }
  }

  let best = -1;
  while (heap.size > 0) {
    const [cost, item] = heap.pop();
    if (item < 0) {
      best = -1 - item;
      break;
    }
    if (cost > (dist[item] ?? Infinity)) continue;
    const d = (item % 4) as Dir;
    const node = (item - d) / 4;
    const i = node % nx;
    const j = (node - i) / nx;
    const price = finish.get(item);
    if (price !== undefined) heap.push(cost + price, -1 - item);
    for (const turn of [0, 1, 3]) {
      const nd = ((d + turn) % 4) as Dir;
      if (!edgeOpen(i, j, nd)) continue;
      const ni = i + DX[nd];
      const nj = j + DY[nd];
      const length = Math.abs(
        (xs[ni] ?? 0) - (xs[i] ?? 0) + (ys[nj] ?? 0) - (ys[j] ?? 0),
      );
      const next = (nj * nx + ni) * 4 + nd;
      const total = cost + length + (turn === 0 ? 0 : BEND);
      if (total < (dist[next] ?? Infinity)) {
        dist[next] = total;
        parent[next] = item;
        heap.push(total, next);
      }
    }
  }
  if (best < 0) return null;

  const points: Point[] = [];
  let at = best;
  for (;;) {
    const d = at % 4;
    const node = (at - d) / 4;
    const i = node % nx;
    points.push([xs[i] ?? 0, ys[(node - i) / nx] ?? 0]);
    const before = parent[at] ?? -1;
    if (before < 0) {
      const first = startPoint.get(at);
      if (first !== undefined) points.push(first);
      break;
    }
    at = before;
  }
  points.reverse();

  // Only the bends: drop a point that lies on the line between its neighbors.
  const line: Point[] = [];
  for (const p of points) {
    const a = line.at(-2);
    const b = line.at(-1);
    if (
      a !== undefined &&
      b !== undefined &&
      ((same(a[0], b[0]) && same(b[0], p[0])) ||
        (same(a[1], b[1]) && same(b[1], p[1])))
    ) {
      line[line.length - 1] = p;
    } else {
      line.push(p);
    }
  }
  const ring = line.at(-1);
  return ring === undefined || line.length < 2 ? null : { line, ring };
}
