/**
 * The preview notice (#70) on each kind of screen, in both languages: the
 * start screen, a wizard step and the dashboard shell. Server-rendered, as in
 * App.test.tsx: the tests run in Node without a DOM.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "../App";
import { en, sl } from "../i18n/messages";
import {
  initialWizardState,
  wizardReducer,
  type WizardAction,
  type WizardState,
} from "../state/wizard";

function stateAfter(...actions: WizardAction[]): WizardState {
  return actions.reduce(wizardReducer, initialWizardState);
}

const SCREENS: [string, WizardState][] = [
  ["start", initialWizardState],
  ["files", stateAfter({ type: "startDemo" })],
  [
    "dashboard",
    stateAfter({ type: "startDemo" }, { type: "goTo", screen: "dashboard" }),
  ],
];

const NOTICE =
  /<section class="preview-notice" aria-labelledby="preview-notice-title">(.*?)<\/section>/s;

for (const [locale, t] of [
  ["sl", sl],
  ["en", en],
] as const) {
  describe(`preview notice (${locale})`, () => {
    for (const [name, state] of SCREENS) {
      it(`${name}: a region named by its title, holding a note`, () => {
        const html = renderToStaticMarkup(
          <App initialLocale={locale} initialState={state} />,
        );
        const notice = NOTICE.exec(html);
        expect(notice, "the preview notice").not.toBeNull();
        const inner = notice?.[1] ?? "";
        expect(inner).toContain('role="note"');
        expect(inner).toContain(
          `<strong id="preview-notice-title">${t.preview.noticeTitle}</strong>`,
        );
        expect(inner).toContain(t.preview.noticeBody);
        // Nothing hides it for good: it has no control at all.
        expect(inner).not.toContain("<button");
      });

      it(`${name}: in the page flow after the sticky header, before the content`, () => {
        const html = renderToStaticMarkup(
          <App initialLocale={locale} initialState={state} />,
        );
        const at = html.search(NOTICE);
        expect(html.indexOf("</header>")).toBeGreaterThan(-1);
        expect(html.indexOf("</header>")).toBeLessThan(at);
        expect(at).toBeLessThan(html.indexOf("<main"));
      });
    }
  });
}
