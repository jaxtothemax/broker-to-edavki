/**
 * Where the app's notices sit (#70): beside what they are about, never in a
 * stack above every screen. The preview's caution (the readers are not
 * checked against real exports yet) is said where the user adds their own
 * files and again by the downloads, once each; the demo is marked by a chip.
 * Server-rendered, as in App.test.tsx: the tests run in Node without a DOM.
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

const DEMO: [string, WizardState][] = [
  ["start", initialWizardState],
  ["files", stateAfter({ type: "startDemo" })],
  [
    "details",
    stateAfter({ type: "startDemo" }, { type: "goTo", screen: "details" }),
  ],
  [
    "dashboard",
    stateAfter({ type: "startDemo" }, { type: "goTo", screen: "dashboard" }),
  ],
];

const withOwnFile = stateAfter(
  { type: "startOwn" },
  {
    type: "addFiles",
    files: [{ id: "file-1", name: "export.csv", size: 2048 }],
  },
);

/** The text as the server writes it into the markup. */
const escaped = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("'", "&#x27;")
    .replaceAll('"', "&quot;");

const count = (html: string, part: string) =>
  html.split(escaped(part)).length - 1;

for (const [locale, t] of [
  ["sl", sl],
  ["en", en],
] as const) {
  const render = (state: WizardState) =>
    renderToStaticMarkup(<App initialLocale={locale} initialState={state} />);

  describe(`notices in context (${locale})`, () => {
    for (const [name, state] of DEMO) {
      it(`${name}: no notice between the header and the content`, () => {
        const html = render(state);
        const between = html.slice(
          html.indexOf("</header>"),
          html.indexOf("<main"),
        );
        expect(between).not.toContain('role="note"');
        expect(count(html, t.preview.noticeBody)).toBe(0);
      });
    }

    it("files: the caution once, by the user's own files", () => {
      const html = render(withOwnFile);
      expect(count(html, t.preview.noticeBody)).toBe(1);
      expect(html.indexOf(escaped(t.preview.noticeBody))).toBeGreaterThan(
        html.indexOf("export.csv"),
      );
    });

    it("files: no caution before the user has added a file", () => {
      expect(
        count(render(stateAfter({ type: "startOwn" })), t.preview.noticeBody),
      ).toBe(0);
    });
  });
}
