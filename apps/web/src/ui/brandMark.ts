/**
 * The fund-house mark for a security, found by the start of its name: an ISIN
 * says where a fund is domiciled, not who issues it, and a fund's name leads
 * with its issuer ("Vanguard S&P 500 (Acc)", "iShares Core MSCI World"), in
 * every broker's export.
 *
 * The name comes from an imported file, so it is bounded before it is read and
 * compared with `startsWith`, never a pattern built from it.
 */
import { BRAND_MARKS, type BrandMark } from "./brandMarks";

/** Longer than any issuer prefix; the rest of a name is never read. */
const READ_CHARS = 48;

const isWordChar = (char: string) =>
  char.toLowerCase() !== char.toUpperCase() || (char >= "0" && char <= "9");

export function brandMarkOf(name: string): BrandMark | undefined {
  const head = name.slice(0, READ_CHARS).trimStart().toLowerCase();
  for (const mark of BRAND_MARKS) {
    for (const prefix of mark.names) {
      // "Vanguardia" is not Vanguard: the prefix has to end the first word.
      if (head.startsWith(prefix) && !isWordChar(head.charAt(prefix.length))) {
        return mark;
      }
    }
  }
  return undefined;
}
