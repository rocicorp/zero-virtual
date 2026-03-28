import {expect, test} from '@playwright/test';
import {TEST_ITEMS} from '../seed-test.ts';

const TIMEOUT = 15_000;

// In the default sort (modified desc) Alpha Item is at index 0.
const ALPHA = TEST_ITEMS.find(i => i.title === 'Alpha Item')!;

test.describe('Item detail panel', () => {
  test.beforeEach(async ({page}) => {
    await page.goto('/');
    // Wait for the list to have real rows loaded.
    await expect(page.locator('a[data-index="0"]')).toBeVisible({
      timeout: TIMEOUT,
    });
  });

  test('clicking a row opens the detail panel', async ({page}) => {
    await page.locator('a[data-index="0"]').click();

    // The panel should appear and show the item title in an <h2>.
    await expect(page.getByRole('heading', {level: 2})).toContainText(
      'Alpha Item',
      {timeout: TIMEOUT},
    );
  });

  test('detail panel shows the item description', async ({page}) => {
    await page.locator('a[data-index="0"]').click();

    await expect(page.getByText(ALPHA.description)).toBeVisible({
      timeout: TIMEOUT,
    });
  });

  test('detail panel shows the item ID', async ({page}) => {
    await page.locator('a[data-index="0"]').click();

    await expect(page.getByText(ALPHA.id)).toBeVisible({timeout: TIMEOUT});
  });

  test('clicking a row sets the URL hash to the item ID', async ({page}) => {
    await page.locator('a[data-index="0"]').click();

    await expect(page).toHaveURL(`/#${ALPHA.id}`, {timeout: TIMEOUT});
  });

  test('the selected row gets aria-selected="true"', async ({page}) => {
    await page.locator('a[data-index="0"]').click();

    // After clicking, the row should carry aria-selected.
    await expect(page.locator(`a[href="#${ALPHA.id}"]`)).toHaveAttribute(
      'aria-selected',
      'true',
      {timeout: TIMEOUT},
    );
  });

  test('close button hides the detail panel', async ({page}) => {
    await page.locator('a[data-index="0"]').click();

    // Confirm panel opened.
    await expect(page.getByRole('heading', {level: 2})).toBeVisible({
      timeout: TIMEOUT,
    });

    // Click the close button (aria-label="Close").
    await page.getByRole('button', {name: 'Close'}).click();

    // Panel should no longer be visible.
    await expect(page.getByRole('heading', {level: 2})).not.toBeVisible();
  });

  test('closing the panel clears the URL hash', async ({page}) => {
    await page.locator('a[data-index="0"]').click();
    await expect(page).toHaveURL(`/#${ALPHA.id}`, {timeout: TIMEOUT});

    await page.getByRole('button', {name: 'Close'}).click();

    // Hash should be cleared (URL ends with just /).
    await expect(page).toHaveURL(/\/#?$/, {timeout: TIMEOUT});
  });

  test('navigating directly to a permalink shows the detail panel', async ({
    page,
  }) => {
    await page.goto(`/#${ALPHA.id}`);

    await expect(page.getByRole('heading', {level: 2})).toContainText(
      'Alpha Item',
      {timeout: TIMEOUT},
    );
  });
});
