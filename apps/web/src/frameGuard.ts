/**
 * The frame guard (#4): in a frame, the app does not start.
 *
 * A server stops other sites from framing a page with the frame-ancestors
 * directive of a Content Security Policy header. GitHub Pages sends no custom
 * headers, and a policy in a <meta> tag cannot carry frame-ancestors, so the
 * browser would show the app inside any site's frame. This is defense in
 * depth, not that header: the page can still be framed, but the app refuses
 * to start there and says to open it in its own tab. A frame without scripts
 * runs neither the guard nor the app.
 */
import { LOCALES, type Locale } from "./i18n/format";
import { MESSAGES } from "./i18n/messages";

/** What the guard compares: a Window in the browser. */
export interface FrameView {
  readonly self: unknown;
  readonly top: unknown;
}

/**
 * True unless the page is the top of its tab. Any error while comparing counts
 * as framed: an older browser can throw on reading another origin's `top`,
 * and a guard that cannot tell must not let the app start.
 */
export function isFramed(view: FrameView): boolean {
  try {
    return view.self !== view.top;
  } catch {
    return true;
  }
}

/**
 * Fills the container with the framed page: in each language, the browser's
 * own first (as the <noscript> text in index.html does), a sentence and a link
 * that opens the app as the top page of the tab. Built from elements and
 * textContent, so no markup is parsed and no React starts; the language
 * switch belongs to the app, which does not run here.
 *
 * `href` is the app's own address: index.ts passes the page's origin and path
 * and leaves out the query and fragment, so a framing site cannot add
 * anything to the link through the URL it framed.
 */
export function showFramedNotice(
  container: Element,
  locale: Locale,
  href: string,
): void {
  const doc = container.ownerDocument;
  const main = doc.createElement("main");
  main.setAttribute("class", "frame-guard");
  const order = [locale, ...LOCALES.filter((other) => other !== locale)];
  for (const code of order) {
    const t = MESSAGES[code].preview;
    const block = doc.createElement("div");
    block.setAttribute("lang", code);
    const body = doc.createElement("p");
    body.textContent = t.framedBody;
    const link = doc.createElement("a");
    link.setAttribute("href", href);
    // _top replaces the framing page with the app. noopener is for a browser
    // that opens the link in a new tab instead: the app there then holds no
    // reference back to the frame, or through it to the site around it.
    link.setAttribute("target", "_top");
    link.setAttribute("rel", "noopener");
    link.textContent = t.framedLink;
    const linkLine = doc.createElement("p");
    linkLine.append(link);
    block.append(body, linkLine);
    main.append(block);
  }
  container.replaceChildren(main);
}
