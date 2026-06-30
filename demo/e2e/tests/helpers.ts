import {expect, type Page} from '@playwright/test';
import {TEST_ITEMS} from '../seed-test.ts';

/** Selector for the virtual list's scrollable viewport element. */
export const VIEWPORT_SELECTOR = '[class*="viewport"]';

// In the default sort (modified DESC), Alpha Item is first.
export const ALPHA = TEST_ITEMS.find(i => i.title === 'Alpha Item')!;

/** The virtual list's scroll container as an element handle. */
export async function viewportHandle(page: Page) {
  const el = await page.locator(VIEWPORT_SELECTOR).elementHandle();
  if (!el) throw new Error('viewport not found');
  return el;
}

/**
 * Wait for the web fonts (Inter / IBM Plex Mono) to finish loading, so a
 * mid-test font swap can't reflow text under a click or a position
 * measurement. Resolves immediately when fonts are cached or unavailable.
 */
async function waitForFonts(page: Page) {
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Wait until the list has real rows loaded (an <a> element, not a
 * placeholder <div>).
 */
export async function waitForRows(page: Page, timeout = 15_000) {
  await expect(
    page.locator(`${VIEWPORT_SELECTOR} a[href^="#"]`).first(),
  ).toBeVisible({timeout});
  await waitForFonts(page);
}

/**
 * Load `/` and wait until the list has real rows loaded — in the default
 * sort (modified DESC) the first row is Alpha Item.
 */
export async function gotoHomeAndWaitForRows(page: Page, timeout = 20_000) {
  await page.goto('/');
  await expect(page.locator(`a[href="#${ALPHA.id}"]`)).toBeVisible({timeout});
  await waitForFonts(page);
}

/**
 * Scroll the viewport partway down (scrollTop = 800) — enough that the top
 * of the list is well off-screen — and wait for a row around that scroll
 * offset to appear.
 */
export async function scrollToMidList(page: Page, timeout = 20_000) {
  const vp = await viewportHandle(page);
  await vp.evaluate(el => {
    el.scrollTop = 800;
  });
  await expect(
    page
      .locator(
        'a[href="#tstitem016"], a[href="#tstitem021"], a[href="#tstitem026"]',
      )
      .first(),
  ).toBeVisible({timeout});
}

/**
 * The href of the rendered row nearest the top edge of the viewport
 * (smallest |row.top − viewport.top|), or null if no rows are rendered.
 */
export function topVisibleRowHref(page: Page): Promise<string | null> {
  return page.evaluate(sel => {
    const viewport = document.querySelector(sel);
    if (!viewport) return null;
    const vpTop = viewport.getBoundingClientRect().top;
    let best: {href: string | null; dist: number} | null = null;
    for (const row of viewport.querySelectorAll('a[href^="#"]')) {
      const dist = Math.abs(row.getBoundingClientRect().top - vpTop);
      if (!best || dist < best.dist) {
        best = {href: row.getAttribute('href'), dist};
      }
    }
    return best?.href ?? null;
  }, VIEWPORT_SELECTOR);
}

/**
 * Navigate in-page to `#id` and wait for the URL to update.
 *
 * This must use the Navigation API (`navigation.navigate`), not
 * `location.hash`: in-page hash navigations only trigger re-anchoring when
 * the persisted scroll state changes between the old and new history
 * entries. The virtualizer debounces persisting its scroll state at 100ms,
 * so callers must wait for it to be persisted before navigating away.
 */
export async function navigateToHash(page: Page, id: string) {
  await page.evaluate(id => {
    navigation.navigate(`#${id}`);
  }, id);
  await page.waitForURL(`/#${id}`);
}
