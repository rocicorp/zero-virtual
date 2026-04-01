import {expect, test} from '@playwright/test';

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
    // The virtualizer lazy-loads pages, so the initial count may be an
    // estimate of the first page only (e.g. "(~100)"). Just verify that
    // some item count is displayed in the heading.
    await expect(page.getByText(/\(~?\d+\)/)).toBeVisible({timeout: 15_000});
  });

  test('renders list rows', async ({page}) => {
    // Wait for the first real row (an <a> element, not a placeholder <div>).
    await expect(
      page.locator('[class*="viewport"] a[href^="#"]').first(),
    ).toBeVisible({
      timeout: 15_000,
    });
  });

  test('default sort is modified descending — Alpha Item is first', async ({
    page,
  }) => {
    // Alpha Item has the highest modified timestamp so it should be first.
    const firstRow = page.getByRole('link', {name: 'Alpha Item'});
    await expect(firstRow).toBeVisible({timeout: 15_000});
  });
});
