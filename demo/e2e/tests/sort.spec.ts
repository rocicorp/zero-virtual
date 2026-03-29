import {expect, test} from '@playwright/test';

// Seed data ordering summary (see seed-test.ts for details):
//
//   modified DESC (default) → Alpha Item    first  (modified = BASE+10H)
//   modified ASC            → Test Item 200 first  (modified = BASE−190H)
//   created  DESC           → Kappa Item    first  (created  = BASE+10H)
//   created  ASC            → Test Item 011 first  (created  = BASE−190H)

const TIMEOUT = 15_000;

test.describe('Sort controls', () => {
  test.beforeEach(async ({page}) => {
    await page.goto('/');
    // Wait until the list has loaded real rows.
    await expect(page.locator('a[data-index="0"]')).toBeVisible({
      timeout: TIMEOUT,
    });
  });

  test('default state: sort field button reads "Modified"', async ({page}) => {
    await expect(page.getByRole('button', {name: 'Modified'})).toBeVisible();
  });

  test('default state: sort direction button title is "Descending"', async ({
    page,
  }) => {
    await expect(
      page.getByRole('button', {name: 'Descending'}),
    ).toBeVisible();
  });

  test('default (modified desc): Alpha Item is first', async ({page}) => {
    await expect(page.locator('a[data-index="0"]')).toContainText('Alpha Item');
  });

  test('toggle sort field to created → Kappa Item is first (created desc)', async ({
    page,
  }) => {
    // Click the sort-field button — it shows the current field and toggles.
    await page.getByRole('button', {name: 'Modified'}).click();

    await expect(page.getByRole('button', {name: 'Created'})).toBeVisible();

    // Kappa Item has the highest created timestamp (BASE+10H).
    await expect(page.locator('a[data-index="0"]')).toContainText('Kappa Item', {
      timeout: TIMEOUT,
    });
  });

  test('toggle direction to asc while on created → Test Item 011 is first (created asc)', async ({
    page,
  }) => {
    await page.getByRole('button', {name: 'Modified'}).click();
    await expect(page.locator('a[data-index="0"]')).toContainText('Kappa Item', {
      timeout: TIMEOUT,
    });

    // Flip direction: "Descending" → "Ascending".
    await page.getByRole('button', {name: 'Descending'}).click();
    await expect(page.getByRole('button', {name: 'Ascending'})).toBeVisible();

    // Test Item 011 has the lowest created timestamp (BASE−190H).
    await expect(page.locator('a[data-index="0"]')).toContainText(
      'Test Item 011',
      {timeout: TIMEOUT},
    );
  });

  test('toggle field back to modified while on created asc → Test Item 200 is first (modified asc)', async ({
    page,
  }) => {
    // Navigate to created asc.
    await page.getByRole('button', {name: 'Modified'}).click();
    await page.getByRole('button', {name: 'Descending'}).click();
    await expect(page.locator('a[data-index="0"]')).toContainText(
      'Test Item 011',
      {timeout: TIMEOUT},
    );

    // Switch field back to modified (direction stays asc → modified asc).
    await page.getByRole('button', {name: 'Created'}).click();
    await expect(page.getByRole('button', {name: 'Modified'})).toBeVisible();

    // Test Item 200 has the lowest modified timestamp (BASE−190H).
    await expect(page.locator('a[data-index="0"]')).toContainText(
      'Test Item 200',
      {timeout: TIMEOUT},
    );
  });
});
