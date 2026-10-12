import { describe, expect, it } from "vitest";

import {
  bottom,
  choose,
  CLEARANCE,
  cutoutOf,
  dimPath,
  gutterWidth,
  intersect,
  linePath,
  placeGutter,
  placeRow,
  placeSheetRing,
  right,
  rowCardBand,
  rowWidth,
  scrollDelta,
  scrollLeftFor,
  SPACE,
  union,
  within,
  type Box,
  type Frame,
  type Placed,
} from "./layout";
import { lineClear } from "./route";

const frame = (width: number, height: number): Frame => ({
  width,
  height,
  headerBottom: 64,
  dockTop: height - 120,
});

const overlaps = (a: Box, b: Box) =>
  a.left < right(b) &&
  b.left < right(a) &&
  a.top < bottom(b) &&
  b.top < bottom(a);

/** The promises every placement keeps, whatever the window. */
function expectSound(f: Frame, cutout: Box, placed: readonly Placed[]): void {
  for (const p of placed) {
    expect(overlaps(p.box, cutout), "a box covers the card").toBe(false);
    expect(p.box.left).toBeGreaterThanOrEqual(SPACE.edge - 0.5);
    expect(right(p.box)).toBeLessThanOrEqual(f.width - SPACE.edge + 0.5);
    if (p.line !== null && p.ring !== null) {
      expect(p.line.at(-1)).toEqual(p.ring);
    }
  }
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const a = placed[i];
      const b = placed[j];
      if (a && b)
        expect(overlaps(a.box, b.box), "two boxes overlap").toBe(false);
    }
  }
}

/** A card of the container's width (1200px max, 24px padding), centered. */
const fullWidthCard = (f: Frame, top: number, height: number): Box => {
  const width = Math.min(1200, f.width) - 48;
  return { left: (f.width - width) / 2, top, width, height };
};

describe("the cutout", () => {
  it("grows the card by its padding and stays inside the window", () => {
    const f = frame(1280, 800);
    expect(
      cutoutOf({ left: 4, top: 100, width: 200, height: 50 }, 8, f),
    ).toEqual({
      left: 0,
      top: 92,
      width: 212,
      height: 66,
    });
  });

  it("covers every element a stop lights", () => {
    expect(
      union([
        { left: 10, top: 10, width: 10, height: 10 },
        { left: 40, top: 30, width: 10, height: 10 },
      ]),
    ).toEqual({ left: 10, top: 10, width: 40, height: 30 });
    expect(union([])).toBeNull();
  });
});

describe("beside the card", () => {
  const f = frame(1440, 900);
  // The gains-tax card: the left seven twelfths of a 1200px container.
  const card: Box = { left: 144, top: 200, width: 676, height: 300 };
  const cutout = cutoutOf(card, 8, f);
  const targets: Box[] = [
    { left: 740, top: 220, width: 64, height: 24 },
    { left: 160, top: 330, width: 640, height: 28 },
    { left: 160, top: 400, width: 640, height: 80 },
  ];

  it("uses the gutter that has room, never covering the card", () => {
    const width = gutterWidth(f, cutout);
    expect(width).toBe(320);
    const heights = [70, 90, 90];
    const presentation = choose(
      f,
      cutout,
      targets,
      { gutter: heights, row: heights },
      "gutter",
    );
    expect(presentation.mode).toBe("gutter");
    const placed = placeGutter(f, cutout, targets, heights, width ?? 0);
    expectSound(f, cutout, placed);
    for (const p of placed) {
      expect(p.side).toBe("right");
      expect(p.box.top).toBeGreaterThanOrEqual(f.headerBottom + SPACE.header);
      expect(bottom(p.box)).toBeLessThanOrEqual(f.dockTop - SPACE.edge);
    }
  });

  it("draws a straight line where the box can sit level with its target", () => {
    const placed = placeGutter(f, cutout, [targets[0] ?? null], [70], 320);
    expect(placed[0]?.line).toHaveLength(2);
  });

  it("finds no gutter beside a card as wide as the container", () => {
    const wide = cutoutOf(fullWidthCard(f, 200, 300), 8, f);
    expect(gutterWidth(f, wide)).toBeNull();
  });
});

describe("above and below the card", () => {
  for (const width of [768, 1024, 1280, 1440]) {
    it(`keeps every box off the card at ${String(width)}px`, () => {
      const f = frame(width, 900);
      const card = fullWidthCard(f, 0, 220);
      const targets: Box[] = [
        { left: card.left + 120, top: 0, width: 60, height: 20 },
        { left: right(card) - 300, top: 0, width: 80, height: 20 },
        { left: right(card) - 140, top: 0, width: 120, height: 20 },
      ];
      const heights = [80, 100, 90];
      const sides = ["above", "below", "below"] as const;
      // Scroll so the card sits in the band its rows leave it.
      const band = rowCardBand(f, sides, heights);
      const shift = -scrollDelta({ ...card, top: 0 }, band);
      const placedCard = { ...card, top: shift };
      const cutout = cutoutOf(placedCard, 8, f);
      const moved = targets.map((t, i) => ({ ...t, top: shift + 10 + i * 90 }));
      const w = rowWidth(f, 3);
      expect(w).not.toBeNull();
      const placed = placeRow(f, cutout, moved, heights, w ?? 0, sides);
      expectSound(f, cutout, placed);
      for (const p of placed) {
        expect(p.box.top).toBeGreaterThanOrEqual(
          f.headerBottom + SPACE.header - 0.5,
        );
        expect(bottom(p.box)).toBeLessThanOrEqual(f.dockTop - SPACE.edge + 0.5);
      }
    });
  }

  it("is chosen for a full-width card, and falls to the sheet when too tall", () => {
    const f = frame(1280, 800);
    const card = cutoutOf(fullWidthCard(f, 200, 200), 8, f);
    const targets: Box[] = [{ left: 300, top: 220, width: 80, height: 20 }];
    expect(
      choose(f, card, targets, { gutter: [90], row: [90] }, "gutter").mode,
    ).toBe("row");
    const tall = cutoutOf(fullWidthCard(f, 100, 600), 8, f);
    expect(
      choose(f, tall, targets, { gutter: [90], row: [90] }, "row").mode,
    ).toBe("sheet");
  });
});

describe("one at a time", () => {
  it("is what a phone gets, whatever fits", () => {
    for (const width of [320, 390, 719]) {
      const f = frame(width, 800);
      const card = cutoutOf(
        { left: 16, top: 200, width: width - 32, height: 100 },
        8,
        f,
      );
      expect(
        choose(f, card, [null], { gutter: [60], row: [60] }, "row"),
      ).toEqual({
        mode: "sheet",
      });
    }
  });
});

describe("scrolling into view", () => {
  it("centers the subject in its band, or aligns the top of a tall one", () => {
    const band = { top: 100, bottom: 500 };
    expect(
      scrollDelta({ left: 0, top: 700, width: 10, height: 100 }, band),
    ).toBe(450);
    expect(
      scrollDelta({ left: 0, top: 700, width: 10, height: 900 }, band),
    ).toBe(600);
  });

  it("scrolls a table sideways only to bring a clipped cell into view", () => {
    const scroller = {
      box: { left: 20, top: 0, width: 300, height: 200 },
      clientLeft: 0,
      clientWidth: 300,
      scrollLeft: 0,
      scrollWidth: 900,
    };
    expect(
      scrollLeftFor(scroller, { left: 40, top: 0, width: 50, height: 20 }),
    ).toBeNull();
    expect(
      scrollLeftFor(scroller, { left: 600, top: 0, width: 80, height: 20 }),
    ).toBe(470);
    expect(
      scrollLeftFor(scroller, { left: 1200, top: 0, width: 80, height: 20 }),
    ).toBe(600);
  });

  it("scrolls a bordered table to its very end, not a border short of it", () => {
    // A 1px border each side: the border box is 302 wide, the scrolling
    // padding box 300, so the last scrollLeft is 900 - 300, not 900 - 302.
    const scroller = {
      box: { left: 19, top: 0, width: 302, height: 200 },
      clientLeft: 1,
      clientWidth: 300,
      scrollLeft: 0,
      scrollWidth: 900,
    };
    expect(
      scrollLeftFor(scroller, { left: 1200, top: 0, width: 80, height: 20 }),
    ).toBe(600);
    // A cell under the right border is not in view, though it is in the box.
    expect(
      scrollLeftFor(scroller, { left: 301, top: 0, width: 20, height: 20 }),
    ).toBe(141);
  });
});

describe("intersect", () => {
  it("keeps the part of a box inside the clip, or nothing", () => {
    const clip = { left: 0, top: 60, width: 320, height: 160 };
    // A field taller than the room above the sheet: its top part shows.
    expect(
      intersect({ left: 50, top: 70, width: 200, height: 300 }, clip),
    ).toEqual({ left: 50, top: 70, width: 200, height: 150 });
    expect(
      intersect({ left: 50, top: 400, width: 200, height: 30 }, clip),
    ).toBeNull();
    // Touching edges share no area.
    expect(
      intersect({ left: 320, top: 70, width: 20, height: 20 }, clip),
    ).toBeNull();
  });
});

describe("drawing", () => {
  it("leaves the cutout open in the dim", () => {
    const f = frame(400, 300);
    expect(dimPath(f, null, 8)).toBe("M0 0H400V300H0Z");
    expect(
      dimPath(f, { left: 10, top: 10, width: 100, height: 50 }, 8),
    ).toMatch(/^M0 0H400V300H0Z M18 10 /);
  });

  it("draws a line through its points", () => {
    expect(
      linePath([
        [0, 0],
        [10.004, 5],
      ]),
    ).toBe("M0 0 L10 5");
  });

  it("knows when one box lies inside another", () => {
    const outer = { left: 0, top: 0, width: 100, height: 100 };
    expect(within({ left: 10, top: 10, width: 20, height: 20 }, outer)).toBe(
      true,
    );
    expect(within({ left: 90, top: 10, width: 20, height: 20 }, outer)).toBe(
      false,
    );
  });
});

describe("lines that keep off the text and the controls", () => {
  const f = frame(1440, 900);
  // The gains-tax card with its gutter on the right: a box level with the
  // target, its line running straight along y = 232 from x = 868 to 813.
  const card: Box = { left: 144, top: 200, width: 676, height: 300 };
  const cutout = cutoutOf(card, 8, f);
  const target: Box = { left: 740, top: 220, width: 64, height: 24 };
  const second: Box = { left: 160, top: 330, width: 640, height: 28 };
  const straight = placeGutter(f, cutout, [target], [70], 320)[0];

  it("keeps a line that already crosses nothing, as it was", () => {
    const far = { left: 100, top: 600, width: 50, height: 20 };
    const placed = placeGutter(f, cutout, [target], [70], 320, [far])[0];
    expect(placed?.line).toEqual(straight?.line);
    expect(placed?.ring).toEqual(straight?.ring);
    expect(placed?.blocked).toBe(false);
  });

  it("routes round text that stands on the way", () => {
    const text: Box = { left: 840, top: 224, width: 20, height: 16 };
    const placed = placeGutter(f, cutout, [target], [70], 320, [text])[0];
    expect(placed?.blocked).toBe(false);
    expect(placed?.line).not.toEqual(straight?.line);
    const line = placed?.line ?? [];
    expect(lineClear(line, [text], CLEARANCE.comfortable - 0.01)).toBe(true);
    // From the box's edge, to the ring it draws.
    expect(line[0]?.[0]).toBe(placed?.box.left);
    expect(line.at(-1)).toEqual(placed?.ring);
  });

  it("leaves out a line it cannot draw clear, and says so", () => {
    // The target is walled in by text on all sides.
    const walls: Box[] = [
      { left: 700, top: 190, width: 160, height: 8 },
      { left: 700, top: 262, width: 160, height: 8 },
      { left: 700, top: 190, width: 8, height: 80 },
      { left: 852, top: 190, width: 8, height: 80 },
    ];
    const placed = placeGutter(
      f,
      cutout,
      [target, second],
      [70, 90],
      320,
      walls,
    );
    expect(placed[0]?.line).toBeNull();
    expect(placed[0]?.ring).toBeNull();
    expect(placed[0]?.blocked).toBe(true);
    // The other explanation is not held back by it.
    expect(placed[1]?.blocked).toBe(false);
    expect(placed[1]?.line).not.toBeNull();
  });

  it("is not blocked where its target is out of view", () => {
    const placed = placeGutter(f, cutout, [null], [70], 320, [
      { left: 700, top: 190, width: 160, height: 80 },
    ])[0];
    expect(placed?.line).toBeNull();
    expect(placed?.blocked).toBe(false);
  });

  it("counts text that peeks out from under a box, but not what it wholly hides", () => {
    // Under the box and out of it, on the line: the part in view is in the way.
    const peeking: Box = { left: 850, top: 224, width: 40, height: 16 };
    const placed = placeGutter(f, cutout, [target], [70], 320, [peeking])[0];
    expect(placed?.line).not.toEqual(straight?.line);
    const inView: Box = { left: 850, top: 224, width: 18, height: 16 };
    expect(
      lineClear(placed?.line ?? [], [inView], CLEARANCE.comfortable - 0.01),
    ).toBe(true);
    // Wholly under the box, it is hidden: nothing to cross.
    const hidden: Box = { left: 880, top: 224, width: 60, height: 16 };
    const kept = placeGutter(f, cutout, [target], [70], 320, [hidden])[0];
    expect(kept?.line).toEqual(straight?.line);
  });

  it("keeps clear of the other explanation boxes too", () => {
    // Two targets level with each other; the second box sits where the first
    // line would run if it went straight.
    const placed = placeGutter(
      f,
      cutout,
      [target, { left: 740, top: 262, width: 64, height: 24 }],
      [70, 70],
      320,
    );
    const [a, b] = placed;
    for (const p of [a, b]) {
      for (const other of placed) {
        if (p !== other && p?.line)
          expect(
            lineClear(p.line, [other.box], 0),
            "a line runs through another explanation",
          ).toBe(true);
      }
    }
  });

  it("routes a row's vertical line round text between the card and the target", () => {
    const wide = frame(1280, 900);
    const row = cutoutOf(
      { left: 120, top: 300, width: 1040, height: 200 },
      8,
      wide,
    );
    const aim: Box = { left: 400, top: 320, width: 60, height: 20 };
    const w = rowWidth(wide, 1) ?? 0;
    const text: Box = { left: 410, top: 350, width: 40, height: 14 };
    const clean = placeRow(wide, row, [aim], [80], w, ["below"])[0];
    const around = placeRow(wide, row, [aim], [80], w, ["below"], [text])[0];
    expect(around?.blocked).toBe(false);
    expect(around?.line).not.toEqual(clean?.line);
    expect(
      lineClear(around?.line ?? [], [text], CLEARANCE.comfortable - 0.01),
    ).toBe(true);
  });
});

describe("a box outside the band between the header and the dock", () => {
  const f = frame(1280, 800);
  const w = rowWidth(f, 1) ?? 0;
  const aim: Box = { left: 400, top: 140, width: 60, height: 20 };

  it("blocks a row above a card that sits high, where the box would go under the header", () => {
    // The card's top at 130: a 136px box above it would start at y = -38.
    const high = cutoutOf(
      { left: 120, top: 130, width: 1040, height: 200 },
      8,
      f,
    );
    const [above] = placeRow(f, high, [aim], [136], w, ["above"]);
    expect(above?.box.top).toBeLessThan(f.headerBottom + SPACE.header);
    expect(above?.blocked).toBe(true);
    // The same box below the card is in the band, and kept.
    const [below] = placeRow(f, high, [aim], [136], w, ["below"]);
    expect(below?.blocked).toBe(false);
  });

  it("blocks a row below a card that sits low, where the box would go behind the dock", () => {
    const low = cutoutOf(
      { left: 120, top: 450, width: 1040, height: 150 },
      8,
      f,
    );
    const target: Box = { left: 400, top: 470, width: 60, height: 20 };
    const [below] = placeRow(f, low, [target], [120], w, ["below"]);
    expect(below?.blocked).toBe(true);
  });

  it("blocks a gutter box taller than the band", () => {
    // Pushed up to the band's top, it still reaches past the dock.
    const card = cutoutOf(
      { left: 144, top: 200, width: 676, height: 300 },
      8,
      f,
    );
    const target: Box = { left: 740, top: 220, width: 64, height: 24 };
    const [tall] = placeGutter(f, card, [target], [700], 320);
    expect(tall?.box.top).toBe(f.headerBottom + SPACE.header);
    expect(tall?.blocked).toBe(true);
  });
});

describe("the sheet's ring", () => {
  const f = frame(1280, 800);
  const target: Box = { left: 400, top: 300, width: 100, height: 24 };

  it("sits left of the target where it has room", () => {
    expect(placeSheetRing(target, f, null, [])).toEqual([
      400 - SPACE.ring,
      312,
    ]);
  });

  it("moves to another side where text crowds the left", () => {
    const text: Box = { left: 360, top: 300, width: 30, height: 24 };
    expect(placeSheetRing(target, f, null, [text])).toEqual([
      500 + SPACE.ring,
      312,
    ]);
  });

  it("keeps off the highlight's frame", () => {
    // The frame's left edge runs right where the left ring would sit.
    const cutout: Box = { left: 386, top: 280, width: 400, height: 100 };
    expect(placeSheetRing(target, f, cutout, [])).toEqual([
      500 + SPACE.ring,
      312,
    ]);
  });

  it("still marks the target where no side is clear", () => {
    const crowd: Box = { left: 360, top: 260, width: 200, height: 110 };
    expect(placeSheetRing(target, f, null, [crowd])).toEqual([
      400 - SPACE.ring,
      312,
    ]);
  });

  it("never sits outside the window", () => {
    const edge: Box = { left: 2, top: 300, width: 100, height: 24 };
    expect(placeSheetRing(edge, f, null, [])).toEqual([102 + SPACE.ring, 312]);
  });
});

describe("a presentation whose lines cannot be drawn clear", () => {
  const f = frame(1280, 800);
  const card = cutoutOf(fullWidthCard(f, 200, 200), 8, f);
  const targets: Box[] = [{ left: 300, top: 220, width: 80, height: 20 }];
  const heights = { gutter: [90], row: [90] };

  it("is asked about, and the next one is tried", () => {
    const asked: string[] = [];
    const chosen = choose(f, card, targets, heights, "gutter", false, (p) => {
      asked.push(p.mode);
      return true;
    });
    expect(asked).toEqual(["row"]);
    expect(chosen.mode).toBe("row");
  });

  it("falls to the sheet, which has no line, when none can", () => {
    const chosen = choose(
      f,
      card,
      targets,
      heights,
      "gutter",
      false,
      () => false,
    );
    expect(chosen.mode).toBe("sheet");
  });
});
