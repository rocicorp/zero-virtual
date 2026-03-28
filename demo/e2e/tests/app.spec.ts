import {expect, test} from '@playwright/test';
import {TEST_ITEMS} from '../seed-test.ts';

test.describe('App', () => {
  test.beforeEach(async ({page}) => {
    await page.goto('/');
  });

  test('shows the page heading', async ({page}) => {
    await expect(page.getByRole('heading', {level: 1})).toContainText(
      'Zero Virtual Demo',
    );
  });

  test('shows the correct item count', async ({page}) => {
    // The count is shown as "(N)" once all items have loaded.
    await expect(page.getByText(`(${TEST_ITEMS.length})`)).toBeVisible({
      timeout: 15_000,
    });
  });

  test('renders list rows', async ({page}) => {
    // Wait for the first real row (an <a> element, not a placeholder <div>).
    await expect(page.locator('a[data-index="0"]')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('default sort is modified descending — Alpha Item is first', async ({
    page,
  }) => {
    // Alpha Item has the highest modified timestamp so it should be at index 0.
    const firstRow = page.locator('a[data-index="0"]');
    await expect(firstRow).toContainText('Alpha Item', {timeout: 15_000});
  });
});
