/**
 * A stand-in for the few DOM calls the frame guard makes (frameGuard.ts). The
 * tests run in Node with no DOM, so this records the elements built, and a
 * test reads back their tags, attributes, text and order. For tests only;
 * nothing in the app imports it.
 */
export class FakeElement {
  readonly tagName: string;
  readonly ownerDocument: FakeDocument;
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  textContent = "";

  constructor(tagName: string, ownerDocument: FakeDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...nodes);
  }

  /** Every element below this one, in document order. */
  descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  /** This element's text and its children's, in document order. */
  text(): string {
    return [this.textContent, ...this.children.map((child) => child.text())]
      .filter((part) => part !== "")
      .join(" ");
  }
}

export class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }
}

/** An empty #root, and the same object typed as the element it stands for. */
export function fakeRoot(): {
  readonly root: FakeElement;
  readonly element: Element;
} {
  const root = new FakeDocument().createElement("div");
  root.setAttribute("id", "root");
  return { root, element: root as unknown as Element };
}
