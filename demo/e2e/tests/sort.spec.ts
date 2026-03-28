import {expect, test} from '@playwright/test';

// Seed data ordering summary (see seed-test.ts):
//
//   modified DESC (default): Alpha first,  Kappa last
//   modified ASC:            Kappa first,  Alpha last
//   created  DESC:           Kappa first,  Alpha last
//   created  ASC:            Alpha first,  Kappa last

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
    await expect(
      page.getByRole('button', {name: 'Modified'}),
    ).toBeVisible();
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
    // Click the sort-field button (shows current field, toggles to the other).
    await page.getByRole('button', {name: 'Modified'}).click();

    // Button should now read "Created".
    await expect(page.getByRole('button', {name: 'Created'})).toBeVisible();

    // Kappa Item has the highest created timestamp.
    await expect(page.locator('a[data-index="0"]')).toContainText('Kappa Item', {
      timeout: TIMEOUT,
    });
  });

  test('toggle sort direction to asc while on created → Alpha Item is first (created asc)', async ({
    page,
  }) => {
    // Switch to created field first.
    await page.getByRole('button', {name: 'Modified'}).click();
    await expect(page.locator('a[data-index="0"]')).toContainText('Kappa Item', {
      timeout: TIMEOUT,
    });

    // Now flip direction: button title is "Descending" → becomes "Ascending".
    await page.getByRole('button', {name: 'Descending'}).click();
    await expect(page.getByRole('button', {name: 'Ascending'})).toBeVisible();

    // Alpha Item has the lowest created timestamp.
    await expect(page.locator('a[data-index="0"]')).toContainText('Alpha Item', {
      timeout: TIMEOUT,
    });
  });

  test('returning to modified asc after created asc → Kappa Item is first', async ({
    page,
  }) => {
    // Start: modified desc → switch to created desc → flip to created asc.
    await page.getByRole('button', {name: 'Modified'}).click();
    await page.getByRole('button', {name: 'Descending'}).click();
    await expect(page.locator('a[data-index="0"]')).toContainText('Alpha Item', {
      timeout: TIMEOUT,
    });

    // Switch field back to modified (direction stays asc → modified asc).
    await page.getByRole('button', {name: 'Created'}).click();
    await expect(page.getByRole('button', {name: 'Modified'})).toBeVisible();

    // Kappa Item has the lowest modified timestamp.
    await expect(page.locator('a[data-index="0"]')).toContainText('Kappa Item', {
      timeout: TIMEOUT,
    });
  });
});
