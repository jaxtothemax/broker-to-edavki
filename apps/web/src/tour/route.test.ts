import { describe, expect, it } from "vitest";

import type { Box } from "./layout";
import { lineClear, route, type Dir, type End, type RouteInput } from "./route";

/**
 * The router on small, made-up rooms: a box below (its edge at y = 280, the
 * line leaving upward) and a target 40 wide and 20 high above it. Rings may sit
 * 9px outside any of its edges, the one facing the box at no extra cost.
 */
const bounds: Box = { left: 0, top: 0, width: 400, height: 300 };
const CLEARANCE = 4;

const box = (
  left: number,
  top: number,
  width: number,
  height: number,
): Box => ({
  left,
  top,
  width,
  height,
});

const start: End = {
  a: [100, 280],
  b: [300, 280],
  dir: 3,
  base: 0,
  prefer: 200,
};
// The target is [180..220] x [100..120]; a ring sits 9px outside an edge.
const ring = (
  a: [number, number],
  b: [number, number],
  dir: Dir,
  base: number,
  prefer: number,
): End => ({ a, b, dir, base, prefer });
const rings: readonly End[] = [
  ring([184, 129], [216, 129], 3, 0, 200), // below it, arriving upward
  ring([184, 91], [216, 91], 1, 90, 200), // above it, arriving downward
  ring([171, 104], [171, 116], 0, 40, 110), // left of it, arriving rightward
  ring([229, 104], [229, 116], 2, 40, 110), // right of it, arriving leftward
];

const input = (obstacles: readonly Box[]): RouteInput => ({
  bounds,
  obstacles,
  clearance: CLEARANCE,
  starts: [start],
  rings,
  ringClearance: 7,
});

const segments = (line: readonly (readonly [number, number])[]) =>
  line.slice(1).map((p, k) => [line[k] ?? p, p] as const);

describe("a route", () => {
  it("runs straight where nothing is in the way", () => {
    const found = route(input([]));
    expect(found?.line).toEqual([
      [200, 280],
      [200, 129],
    ]);
    expect(found?.ring).toEqual([200, 129]);
  });

  it("goes round what stands between the box and the target", () => {
    const wall = box(150, 170, 100, 20);
    const found = route(input([wall]));
    expect(found).not.toBeNull();
    const line = found?.line ?? [];
    // It crosses nothing, and keeps its distance.
    expect(lineClear(line, [wall], CLEARANCE - 0.01)).toBe(true);
    // It leaves the box squarely (upward) and ends at the ring it reports.
    expect(line[0]?.[1]).toBe(280);
    expect(line[1]?.[0]).toBe(line[0]?.[0]);
    expect(line[1]?.[1]).toBeLessThan(280);
    expect(line.at(-1)).toEqual(found?.ring);
  });

  it("arrives squarely, toward the target", () => {
    // The wall closes the way below it, so the ring is on a side or above.
    const wall = box(60, 133, 280, 14);
    const found = route(input([wall]));
    expect(found).not.toBeNull();
    const line = found?.line ?? [];
    const [x, y] = found?.ring ?? [0, 0];
    expect([x, y]).not.toEqual([200, 129]);
    const last = segments(line).at(-1);
    expect(last).toBeDefined();
    const [a, b] = last ?? [
      [0, 0],
      [0, 0],
    ];
    if (x === 171)
      expect(b[0]).toBeGreaterThan(a[0]); // from the left, going right
    else if (x === 229)
      expect(b[0]).toBeLessThan(a[0]); // from the right, going left
    else if (y === 91)
      expect(b[1]).toBeGreaterThan(a[1]); // from above, going down
    else throw new Error(`unexpected ring ${String(x)},${String(y)}`);
    expect(lineClear(line, [wall], CLEARANCE - 0.01)).toBe(true);
  });

  it("keeps a ring off the text beside it", () => {
    // Text 5px under the ring's usual spot: no room there, so the ring moves.
    const text = box(150, 134, 100, 14);
    const found = route(input([text]));
    expect(found).not.toBeNull();
    expect(found?.ring).not.toEqual([200, 129]);
    const [x, y] = found?.ring ?? [0, 0];
    const near = x > 150 - 7 && x < 250 + 7 && y > 134 - 7 && y < 148 + 7;
    expect(near, "the ring sits too close to the text").toBe(false);
  });

  it("threads a gap between two things, keeping clear of both", () => {
    const left = box(0, 150, 180, 40);
    const rightWall = box(220, 150, 180, 40);
    const found = route({
      ...input([left, rightWall]),
      starts: [{ ...start, a: [60, 280], b: [100, 280], prefer: 80 }],
    });
    expect(found).not.toBeNull();
    const line = found?.line ?? [];
    expect(lineClear(line, [left, rightWall], CLEARANCE - 0.01)).toBe(true);
    // It climbs through the gap, between the two walls (180 and 220).
    const through = segments(line).some(
      ([a, b]) =>
        a[0] === b[0] && a[0] > 180 && a[0] < 220 && Math.min(a[1], b[1]) < 150,
    );
    expect(through).toBe(true);
  });

  it("squeezes through a narrow gap at the tight clearance, not a wide one", () => {
    // A 12px gap: room for 4px on each side of a line, not for 8.
    const left = box(0, 150, 188, 40);
    const rightWall = box(200, 150, 200, 40);
    const walls = [left, rightWall];
    expect(route({ ...input(walls), clearance: 8 })).toBeNull();
    const found = route({ ...input(walls), clearance: 4 });
    expect(found).not.toBeNull();
    expect(lineClear(found?.line ?? [], walls, 3.99)).toBe(true);
  });

  it("stays inside the room it is given", () => {
    const wall = box(0, 170, 400, 20); // the whole width but for the margins
    const found = route({
      ...input([wall]),
      bounds: box(10, 10, 380, 280),
    });
    for (const [x, y] of found?.line ?? []) {
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x).toBeLessThanOrEqual(390);
      expect(y).toBeGreaterThanOrEqual(10);
      expect(y).toBeLessThanOrEqual(290);
    }
  });

  it("finds no route to a target walled in", () => {
    const walls = [
      box(140, 60, 120, 10),
      box(140, 150, 120, 10),
      box(140, 60, 10, 100),
      box(250, 60, 10, 100),
    ];
    expect(route(input(walls))).toBeNull();
  });

  it("finds no route where every ring is crowded by text", () => {
    // Text all around the target, nearer than the ring needs.
    const crowd = [box(150, 80, 100, 60)];
    expect(route(input(crowd))).toBeNull();
  });

  it("prefers fewer bends to a slightly shorter way", () => {
    const wall = box(190, 170, 20, 20);
    const found = route(input([wall]));
    expect(found).not.toBeNull();
    // Out, along, and back in: never a staircase.
    expect(found?.line.length ?? 99).toBeLessThanOrEqual(5);
  });
});

describe("a line kept clear", () => {
  const thing = box(40, 10, 20, 20);

  it("is clear where it only touches the space around something", () => {
    // The thing grown by 10 starts at y = 0: a line along y = 0 touches it.
    expect(
      lineClear(
        [
          [0, 0],
          [100, 0],
        ],
        [thing],
        10,
      ),
    ).toBe(true);
  });

  it("is not clear where it passes through, or inside the clearance", () => {
    expect(
      lineClear(
        [
          [0, 5],
          [100, 5],
        ],
        [thing],
        10,
      ),
    ).toBe(false);
    expect(
      lineClear(
        [
          [50, 0],
          [50, 100],
        ],
        [thing],
        0,
      ),
    ).toBe(false);
  });

  it("counts a slanted line as crossing, which a route never is", () => {
    expect(
      lineClear(
        [
          [0, 0],
          [10, 10],
        ],
        [],
        0,
      ),
    ).toBe(true);
    expect(
      lineClear(
        [
          [0, 90],
          [100, 80],
        ],
        [thing],
        0,
      ),
    ).toBe(false);
  });
});
