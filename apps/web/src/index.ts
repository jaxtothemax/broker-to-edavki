/**
 * Browser entry (index.html): loads the styles and mounts the app into #root,
 * unless another site has framed the page (frameGuard.ts).
 */
// Fonts are self-hosted: the app never asks a third party for anything.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";

import { createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { isFramed, showFramedNotice } from "./frameGuard";
import { initialLocale } from "./i18n/i18n";

const container = document.getElementById("root");
if (container === null) {
  throw new Error(
    'TaxReporter: index.html has no <div id="root"> to mount into',
  );
}
const locale = initialLocale(window.location.search);
// Checked before anything mounts: GitHub Pages cannot forbid framing (no
// frame-ancestors without headers), so in a frame the app never starts.
if (isFramed(window)) {
  const { origin, pathname } = window.location;
  showFramedNotice(container, locale, `${origin}${pathname}`);
} else {
  createRoot(container).render(
    createElement(
      StrictMode,
      null,
      createElement(App, { initialLocale: locale }),
    ),
  );
}
