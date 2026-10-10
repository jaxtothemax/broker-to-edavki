/**
 * The returns the dashboard offers for download: the user's own, written
 * with the preview, or the demo's, written by the engine chunk the first
 * time the dashboard opens. The dashboard owns this, not a page, so moving
 * between its pages never writes them again.
 */
import { useEffect, useState } from "react";

import type { BuiltReturns } from "../../engine/demoReturns";

/** Where writing the returns stands. */
export type Writing =
  | { readonly status: "preparing" }
  | { readonly status: "ready"; readonly returns: BuiltReturns }
  | { readonly status: "failed" };

/** The source of the returns: written already, or a writer to await. */
export type ReturnsSource = BuiltReturns | (() => Promise<BuiltReturns>);

/**
 * The returns as written, or being written. Null while the user's own files
 * are still being prepared: the dashboard stays one component across that
 * change, so the heading the user was taken to keeps its focus.
 */
export function useReturnsWriting(source: ReturnsSource | null): Writing {
  const [writing, setWriting] = useState<Writing>(
    source === null || typeof source === "function"
      ? { status: "preparing" }
      : { status: "ready", returns: source },
  );
  useEffect(() => {
    if (source === null) {
      setWriting({ status: "preparing" });
      return;
    }
    if (typeof source !== "function") {
      setWriting({ status: "ready", returns: source });
      return;
    }
    let current = true;
    source().then(
      (returns) => {
        if (current) setWriting({ status: "ready", returns });
      },
      () => {
        if (current) setWriting({ status: "failed" });
      },
    );
    return () => {
      current = false;
    };
  }, [source]);
  return writing;
}

/**
 * 28 February, moved to the next working day when it is not one (ZDavP-2
 * Art. 45(2)); for tax year 2026 that is Monday 1 March 2027
 * (docs/research/04-si-tax-rules.md).
 */
export function filingDeadline(taxYear: number): string {
  const due = new Date(Date.UTC(taxYear + 1, 1, 28));
  const day = due.getUTCDay();
  if (day === 6) due.setUTCDate(due.getUTCDate() + 2);
  if (day === 0) due.setUTCDate(due.getUTCDate() + 1);
  return due.toISOString().slice(0, 10);
}
