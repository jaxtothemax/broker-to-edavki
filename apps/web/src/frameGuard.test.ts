import { describe, expect, it } from "vitest";

import { isFramed, showFramedNotice, type FrameView } from "./frameGuard";
import { en, sl } from "./i18n/messages";
import { fakeRoot } from "./testing/fakeDom";

const APP = "https://owner.github.io/repo/app/";

/** A window at the top of its tab: its own top. */
function topLevel(): FrameView {
  const view: { self?: unknown; top?: unknown } = {};
  view.self = view;
  view.top = view;
  return view as FrameView;
}

describe("isFramed", () => {
  it("is false for the top page of a tab", () => {
    expect(isFramed(topLevel())).toBe(false);
  });

  it("is true inside a frame, whose top is another window", () => {
    const view: { self?: unknown; top?: unknown } = {};
    view.self = view;
    view.top = topLevel();
    expect(isFramed(view as FrameView)).toBe(true);
  });

  it("is true in a frame removed from its page, whose top is null", () => {
    const view: { self?: unknown; top?: unknown } = {};
    view.self = view;
    view.top = null;
    expect(isFramed(view as FrameView)).toBe(true);
  });

  it("counts an error while comparing as framed", () => {
    const view: { self: unknown; top?: unknown } = { self: {} };
    Object.defineProperty(view, "top", {
      get: () => {
        throw new Error("Blocked a frame from accessing a cross-origin frame");
      },
    });
    expect(isFramed(view as FrameView)).toBe(true);
  });
});

describe("showFramedNotice", () => {
  it("replaces the container with plain text and a link, the browser's language first", () => {
    const { root, element } = fakeRoot();
    root.append(root.ownerDocument.createElement("p"));

    showFramedNotice(element, "sl", APP);

    expect(root.children.map((child) => child.tagName)).toEqual(["main"]);
    const main = root.children[0];
    expect(main?.attributes.get("class")).toBe("frame-guard");
    const blocks = main?.children ?? [];
    expect(blocks.map((block) => block.attributes.get("lang"))).toEqual([
      "sl",
      "en",
    ]);
    expect(blocks[0]?.text()).toBe(
      `${sl.preview.framedBody} ${sl.preview.framedLink}`,
    );
    expect(blocks[1]?.text()).toBe(
      `${en.preview.framedBody} ${en.preview.framedLink}`,
    );
  });

  it("puts English first for an English browser", () => {
    const { root, element } = fakeRoot();

    showFramedNotice(element, "en", APP);

    const blocks = root.children[0]?.children ?? [];
    expect(blocks.map((block) => block.attributes.get("lang"))).toEqual([
      "en",
      "sl",
    ]);
  });

  it("links the app as the top page of the tab", () => {
    const { root, element } = fakeRoot();

    showFramedNotice(element, "en", APP);

    const links = root.descendants().filter((el) => el.tagName === "a");
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(Object.fromEntries(link.attributes)).toEqual({
        href: APP,
        target: "_top",
        rel: "noopener",
      });
    }
  });
});
