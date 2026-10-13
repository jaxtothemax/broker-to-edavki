/**
 * The shares still held and the broker accounts (#47, ADR 0018) in a real
 * browser, at the three widths of the shell: a desktop's sidebar lists the
 * accounts in its own group; a tablet's rail and a phone's bottom bar have
 * no room for them, so the holdings page lists them instead. Either way an
 * account's page is a keyboard press away, and the demo's IBKR account is
 * flagged: shares were moved into it, and moves are not read yet.
 */
import { expect, test, type Page } from "@playwright/test";

const COPY = {
  "en-GB": {
    // The app opens in Slovenian whatever the browser prefers.
    path: "/?lang=en",
    demo: "Explore the demo",
    nav: "Results",
    holdings: "Holdings",
    accounts: "Accounts",
    flag: "May not match your broker: shares were transferred",
  },
  "sl-SI": {
    path: "/",
    demo: "Preizkusi demo",
    nav: "Rezultati",
    holdings: "Imetje",
    accounts: "Računi",
    flag: "Morda se ne ujema s stanjem pri posredniku: delnice so bile prenesene",
  },
} as const;

const WINDOWS = [
  { width: 1440, height: 900, sidebar: true },
  { width: 768, height: 1024, sidebar: false },
  { width: 390, height: 844, sidebar: false },
] as const;

const heading = (page: Page) => page.locator("#main h1");

async function demoResults(
  page: Page,
  demo: string,
  path: string,
): Promise<void> {
  await page.goto(path);
  await page.getByRole("button", { name: demo }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  for (let step = 0; step < 2; step += 1) {
    await page.locator(".actions-row .btn-primary").click();
  }
  await expect(page.locator(".dash-page:not([hidden])")).toHaveCount(1);
}

for (const locale of ["en-GB", "sl-SI"] as const) {
  const copy = COPY[locale];
  for (const { width, height, sidebar } of WINDOWS) {
    test.describe(`${locale} at ${String(width)}x${String(height)}`, () => {
      test.use({ locale, viewport: { width, height } });

      test("the accounts are a keypress away, and the transferred one is flagged", async ({
        page,
      }) => {
        await demoResults(page, copy.demo, copy.path);
        const nav = page.getByRole("navigation", { name: copy.nav });
        // One navigation at every width.
        await expect(page.getByRole("navigation")).toHaveCount(1);

        await nav
          .getByRole("button", { name: new RegExp(`^${copy.holdings}`) })
          .click();
        await expect(heading(page)).toHaveText(copy.holdings);
        await expect(heading(page)).toBeFocused();

        const group = nav.getByRole("list", { name: copy.accounts });
        const inPage = page.locator(".held-accounts");
        if (sidebar) {
          await expect(group).toBeVisible();
          await expect(inPage).toBeHidden();
        } else {
          await expect(group).toBeHidden();
          await expect(inPage).toBeVisible();
        }
        const ibkr = (sidebar ? group : inPage).getByRole("button", {
          name: /Interactive Brokers/,
        });
        await ibkr.focus();
        await page.keyboard.press("Enter");
        await expect(heading(page)).toHaveText("Interactive Brokers");
        await expect(heading(page)).toBeFocused();
        await expect(
          page.locator(".dash-page:not([hidden])").getByText(copy.flag),
        ).toBeVisible();
        if (sidebar) {
          await expect(ibkr).toHaveAttribute("aria-current", "page");
          // From one account to the other: a new page, focused.
          await group.getByRole("button", { name: /Trading 212/ }).click();
          await expect(heading(page)).toHaveText("Trading 212");
          await expect(heading(page)).toBeFocused();
        }

        // Nothing scrolls sideways but the tables' own regions.
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    });
  }
}
