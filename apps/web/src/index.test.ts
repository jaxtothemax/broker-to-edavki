import { StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { en } from "./i18n/messages";
import { fakeRoot } from "./testing/fakeDom";

// The tests run in Node, with no DOM: stub the things index.ts touches.
vi.mock("react-dom/client", () => ({ createRoot: vi.fn() }));

function stubDocument(root: object | null): void {
  vi.stubGlobal("document", {
    getElementById: (id: string) => (id === "root" ? root : null),
  });
}

/**
 * The window index.ts runs in: the top page of its tab, a page framed by
 * another, or a frame where reading `top` throws. Its address carries a query
 * and a fragment, which the framed page's link must leave out.
 */
function stubWindow(top: "self" | "other" | "throws"): void {
  const view: Record<string, unknown> = {
    location: {
      origin: "https://owner.github.io",
      pathname: "/repo/app/",
      search: "?from=framer",
      hash: "#x",
    },
  };
  view["self"] = view;
  if (top === "throws") {
    Object.defineProperty(view, "top", {
      get: () => {
        throw new Error("Blocked a frame from accessing a cross-origin frame");
      },
    });
  } else {
    view["top"] = top === "self" ? view : {};
  }
  vi.stubGlobal("window", view);
}

describe("index.ts (browser entry)", () => {
  // index.ts mounts as an import side effect, so each case needs a fresh copy,
  // and the mocked createRoot's calls from the case before must not count.
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(createRoot).mockClear();
  });

  it("mounts <App /> inside StrictMode into #root", async () => {
    const container = {};
    const render = vi.fn<(children: ReactNode) => void>();
    vi.mocked(createRoot).mockReturnValue({ render } as unknown as Root);
    stubDocument(container);
    stubWindow("self");

    await import("./index");
    // From the same (reset) module registry index.ts just imported it from.
    const { App } = await import("./App");

    expect(createRoot).toHaveBeenCalledWith(container);
    expect(render.mock.calls[0]?.[0]).toMatchObject({
      type: StrictMode,
      props: { children: { type: App } },
    });
  });

  it("fails loudly when index.html has no #root", async () => {
    stubDocument(null);
    stubWindow("self");

    await expect(import("./index")).rejects.toThrow('no <div id="root">');
  });

  it("does not mount in a frame, and says to open the app in its own tab", async () => {
    const { root, element } = fakeRoot();
    stubDocument(element);
    stubWindow("other");

    await import("./index");

    expect(createRoot).not.toHaveBeenCalled();
    expect(root.text()).toContain(en.preview.framedBody);
    const links = root.descendants().filter((el) => el.tagName === "a");
    expect(links.map((link) => link.attributes.get("href"))).toEqual([
      "https://owner.github.io/repo/app/",
      "https://owner.github.io/repo/app/",
    ]);
  });

  it("counts an error while comparing windows as framed", async () => {
    const { root, element } = fakeRoot();
    stubDocument(element);
    stubWindow("throws");

    await import("./index");

    expect(createRoot).not.toHaveBeenCalled();
    expect(root.text()).toContain(en.preview.framedBody);
  });
});
