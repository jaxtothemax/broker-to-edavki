/**
 * Types for the parts of build-brand-marks.mjs that src/ui/kit.test.tsx
 * calls, so the test compares brandMarks.ts with what the generator itself
 * reads from brand-art/ rather than with a second parser of its own.
 */

/** The viewBox and the paths of one SVG, each with the fill it inherits. */
export function readSvg(
  file: string,
  svg: string,
): {
  viewBox: string;
  paths: { d: string; fill: string; evenOdd: boolean }[];
};

/** Throws unless a manifest entry's source url and license are one line each. */
export function checkSource(
  file: string,
  source: unknown,
): { url: string; license: string };
