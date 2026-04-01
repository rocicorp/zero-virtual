import {expect, test, type Page} from '@playwright/test';

// Seed data ordering summary (see seed-test.ts for details):
//
//   modified DESC (default) → Alpha Item    first  (modified = BASE+10H)
//   modified ASC            → Test Item 200 first  (modified = BASE−190H)
//   created  DESC           → Kappa Item    first  (created  = BASE+10H)
//   created  ASC            → Test Item 011 first  (created  = BASE−190H)

const TIMEOUT = 15_000;

/**
 * Assert that the row containing `text` is the first visible item in
 * the scrollable viewport (i.e. closest to the top edge). Uses a retry
 * loop because sort changes are async.
 */
async function expectFirstVisibleRow(page: Page, text: string) {
  await expect(
    async () => {
      const isFirst = await page.evaluate((txt: string) => {
        const viewport = document.querySelector('[class*="viewport"]');
        if (!viewport) return false;
        const vpTop = viewport.getBoundingClientRect().top;
        const rows = [...viewport.querySelectorAll('a[href^="#"]')];
        if (rows.length === 0) return false;
        // Find the row closest to the viewport top.
        let best: {el: Element; dist: number} | null = null;
        for (const row of rows) {
          const dist = Math.abs(row.getBoundingClientRect().top - vpTop);
          if (!best || dist < best.dist) {
            best = {el: row, dist};
          }
        }
        return best?.el.textContent?.includes(txt) ?? false;
      }, text);
      expect(isFirst).toBe(true);
    },
  ).toPass({timeout: TIMEOUT});
}

test.describe('Sort controls', () => {
  test.beforeEach(async ({page}) => {
    await page.goto('/');
    // Wait until the list has loaded real rows.
    await expect(
      page.locator('[class*="viewport"] a[href^="#"]').first(),
    ).toBeVisible({
      timeout: TIMEOUT,
    });
  });

  test('default state: sort field button reads "Modified"', async ({page}) => {
    await expect(page.getByRole('button', {name: 'Modified'})).toBeVisible();
  });

  test('default state: sort direction button title is "Descending"', async ({
    page,
  }) => {
    await expect(page.getByRole('button', {name: 'Descending'})).toBeVisible();
  });

  test('default (modified desc): Alpha Item is first', async ({page}) => {
    await expectFirstVisibleRow(page, 'Alpha Item');
  });

  test('toggle sort field to created → Kappa Item is first (created desc)', async ({
    page,
  }) => {
    // Click the sort-field button — it shows the current field and toggles.
    await page.getByRole('button', {name: 'Modified'}).click();

    await expect(page.getByRole('button', {name: 'Created'})).toBeVisible();

    // Kappa Item has the highest created timestamp (BASE+10H).
    await expectFirstVisibleRow(page, 'Kappa Item');
  });

  test('toggle direction to asc while on created → Test Item 011 is first (created asc)', async ({
    page,
  }) => {
    await page.getByRole('button', {name: 'Modified'}).click();
    await expectFirstVisibleRow(page, 'Kappa Item');

    // Flip direction: "Descending" → "Ascending".
    await page.getByRole('button', {name: 'Descending'}).click();
    await expect(page.getByRole('button', {name: 'Ascending'})).toBeVisible();

    // Test Item 011 has the lowest created timestamp (BASE−190H).
    await expectFirstVisibleRow(page, 'Test Item 011');
  });

  test('toggle field back to modified while on created asc → Test Item 200 is first (modified asc)', async ({
    page,
  }) => {
    // Navigate to created asc.
    await page.getByRole('button', {name: 'Modified'}).click();
    await page.getByRole('button', {name: 'Descending'}).click();
    await expectFirstVisibleRow(page, 'Test Item 011');

    // Switch field back to modified (direction stays asc → modified asc).
    await page.getByRole('button', {name: 'Created'}).click();
    await expect(page.getByRole('button', {name: 'Modified'})).toBeVisible();

    // Test Item 200 has the lowest modified timestamp (BASE−190H).
    await expectFirstVisibleRow(page, 'Test Item 200');
  });
});
