import { describe, expect, it } from "vitest";

import { initialLocale } from "./i18n";

describe("the language the app opens in", () => {
  it("is Slovenian by default, whatever the browser prefers", () => {
    expect(initialLocale("")).toBe("sl");
    expect(initialLocale("?demo=1")).toBe("sl");
  });

  it("is English when the address asks for it", () => {
    expect(initialLocale("?lang=en")).toBe("en");
    expect(initialLocale("?x=1&lang=en")).toBe("en");
  });

  it("stays Slovenian for anything else in lang", () => {
    expect(initialLocale("?lang=sl")).toBe("sl");
    expect(initialLocale("?lang=EN")).toBe("sl");
    expect(initialLocale("?lang=de")).toBe("sl");
  });
});
