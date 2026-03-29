import {expect, test} from '@playwright/test';
import {TEST_ITEMS} from '../seed-test.ts';

const TIMEOUT = 20_000;

// The virtual list renders only the visible rows. Scrolling causes new pages
// to be fetched and new rows to be inserted into the DOM. With 200 items and a
// min page size of 100, there are at least 2 pages to load.

test.describe('Scroll / paging', () => {
  test.beforeEach(async ({page}) => {
    await page.goto('/');
    await expect(page.locator('a[data-index="0"]')).toBeVisible({
      timeout: TIMEOUT,
    });
  });

  test('initial render shows the correct item count', async ({page}) => {
    await expect(
      page.getByText(`(${TEST_ITEMS.length})`),
    ).toBeVisible({timeout: TIMEOUT});
  });

  test('scrolling to the bottom loads items from the second page', async ({
    page,
  }) => {
    // The scrollable viewport is 2 DOM levels above [data-index="0"]:
    //   <div class="viewport">           ← overflow:auto
    //     <div style="position:relative"> ← total-height spacer
    //       <a data-index="0">            ← first row
    const viewport = page.locator('[data-index="0"]').locator('xpath=../..');

    // Scroll to the very bottom of the virtualised list.
    await viewport.evaluate(el => {
      el.scrollTop = el.scrollHeight;
    });

    // After scrolling, the virtualizer should render rows near the end of the
    // list. At 200 items × 48 px/row the last row index is 199.
    await expect(
      page.locator(`a[data-index="${TEST_ITEMS.length - 1}"]`),
    ).toBeVisible({timeout: TIMEOUT});
  });

  test('scrolling down and back up restores the first item', async ({page}) => {
    const viewport = page.locator('[data-index="0"]').locator('xpath=../..');

    await viewport.evaluate(el => {
      el.scrollTop = el.scrollHeight;
    });

    // Scroll back to the top.
    await viewport.evaluate(el => {
      el.scrollTop = 0;
    });

    await expect(page.locator('a[data-index="0"]')).toBeVisible({
      timeout: TIMEOUT,
    });
    await expect(page.locator('a[data-index="0"]')).toContainText('Alpha Item');
  });
});
