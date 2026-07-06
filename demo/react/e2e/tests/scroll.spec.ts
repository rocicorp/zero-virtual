import {expect, test, type Page} from '@playwright/test';
import {TEST_ITEMS, type TestItem} from '../seed-test.ts';
import {
  ALPHA,
  VIEWPORT_SELECTOR,
  gotoHomeAndWaitForRows,
  navigateToHash,
  scrollToMidList,
  topVisibleRowHref,
  viewportHandle,
  waitForRows,
} from './helpers.ts';

const TIMEOUT = 20_000;

/**
 * Wait for the virtualizer's scroll state to be persisted into the
 * Navigation API's current entry state. The virtualizer debounces
 * `onScrollStateChange` at 100ms, so after the initial data render
 * the state is not immediately available — and an early persist can
 * capture a stale scroll offset, so wait until the persisted scrollTop
 * matches the viewport's current scrollTop. See `navigateToHash` for
 * why this must happen before navigating away.
 */
async function waitForScrollStatePersisted(page: Page) {
  await expect(async () => {
    const persisted = await page.evaluate(sel => {
      const scrollState = (
        navigation.currentEntry?.getState() as Record<string, unknown>
      )?.scrollState as {scrollTop?: number} | null | undefined;
      const vp = document.querySelector(sel);
      return (
        scrollState?.scrollTop != null &&
        vp != null &&
        Math.abs(scrollState.scrollTop - vp.scrollTop) < 1
      );
    }, VIEWPORT_SELECTOR);
    expect(persisted).toBe(true);
  }).toPass({timeout: TIMEOUT});
}

// The virtual list renders only the visible rows. Scrolling causes new pages
// to be fetched and new rows to be inserted into the DOM. With 200 items and a
// min page size of 100, there are at least 2 pages to load.

test.describe('Scroll / paging', () => {
  test.beforeEach(async ({page}) => {
    await gotoHomeAndWaitForRows(page, TIMEOUT);
  });

  test('initial render shows the correct item count', async ({page}) => {
    // The virtualizer lazy-loads pages, so the initial count is an estimate
    // based on the first page only (e.g. "(~100)"). Verify a count appears.
    await expect(page.getByText(/\(~?\d+\)/)).toBeVisible({timeout: TIMEOUT});
  });

  test('scrolling to the bottom loads items from the second page', async ({
    page,
  }) => {
    const viewportEl = await viewportHandle(page);

    // The virtualizer lazy-loads pages, so we need to scroll to the bottom
    // repeatedly — each scroll triggers loading the next page, which extends
    // the scrollable area.
    await expect(async () => {
      await viewportEl.evaluate(el => {
        el.scrollTop = el.scrollHeight;
      });
      await expect(
        page.locator(`a[href="#${TEST_ITEMS[TEST_ITEMS.length - 1].id}"]`),
      ).toBeVisible();
    }).toPass({timeout: TIMEOUT});
  });

  test('scrolling down and back up restores the first item', async ({page}) => {
    const viewportEl = await viewportHandle(page);

    await viewportEl.evaluate(el => {
      el.scrollTop = el.scrollHeight;
    });

    // Scroll back to the top.
    await viewportEl.evaluate(el => {
      el.scrollTop = 0;
    });

    await expect(page.locator(`a[href="#${ALPHA.id}"]`)).toBeVisible({
      timeout: TIMEOUT,
    });
    await expect(page.locator(`a[href="#${ALPHA.id}"]`)).toContainText(
      'Alpha Item',
    );
  });
});

/**
 * Wait for a permalink row to become visible, selected, and showing the
 * item's title. The virtualizer scrolls to the target automatically but the
 * initial data fetch and pagination adjustments are async.
 *
 * Strategy:
 * 1. Wait for any list rows to appear (data loaded).
 * 2. Wait for the scroll position to stabilize (no change for 500 ms).
 * 3. If the target row isn't visible yet, scroll the viewport down in
 *    viewport-sized steps until it appears. This mirrors what a user does
 *    when the virtualizer's auto-scroll undershoots.
 * 4. Assert the row is visible, selected, and shows the item title.
 */
async function waitForPermalinkRow(page: Page, item: TestItem) {
  const row = page.locator(`a[href="#${item.id}"]`);

  // 1. Wait for any rows to be rendered.
  await waitForRows(page, 10_000);

  // 2. Wait for scroll to settle.
  await page.evaluate(
    sel =>
      new Promise<void>(resolve => {
        const vp = document.querySelector(sel);
        if (!vp) {
          resolve();
          return;
        }
        let last = vp.scrollTop;
        const check = () => {
          if (vp.scrollTop === last) {
            resolve();
          } else {
            last = vp.scrollTop;
            setTimeout(check, 50);
          }
        };
        setTimeout(check, 50);
      }),
    VIEWPORT_SELECTOR,
  );

  // 3. If the row isn't visible, scroll down in steps until it appears.
  await expect(async () => {
    //   const visible = await row.isVisible().catch(() => false);
    //   if (!visible) {
    //     await page.evaluate(() => {
    //       const vp = document.querySelector('[class*="viewport"]');
    //       if (vp) vp.scrollTop += vp.clientHeight;
    //     });
    //   }
    await expect(row).toBeVisible({timeout: 1_000});
  }).toPass({timeout: 20_000});

  // 4. Assert selected and showing the right content.
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await expect(row).toContainText(item.title);
}

// ---------------------------------------------------------------------------
// Direct permalink navigation: load the app with a hash already in the URL
// (no prior `/` load). The app must scroll the target row into view and
// select it on first render.
// ---------------------------------------------------------------------------

test.describe('Direct permalink navigation', () => {
  test('first page item — Beta Item', async ({page}) => {
    const beta = TEST_ITEMS.find(i => i.title === 'Beta Item')!;
    await page.goto(`/#${beta.id}`);

    await waitForPermalinkRow(page, beta);
  });

  test('page-boundary item — Test Item 100', async ({page}) => {
    const mid = TEST_ITEMS.find(i => i.title === 'Test Item 100')!;
    await page.goto(`/#${mid.id}`);

    await waitForPermalinkRow(page, mid);
  });

  test('last item — Test Item 200', async ({page}) => {
    const last = TEST_ITEMS.find(i => i.title === 'Test Item 200')!;
    await page.goto(`/#${last.id}`);

    await waitForPermalinkRow(page, last);
  });
});

// ---------------------------------------------------------------------------
// In-page hash navigation: load `/` first, wait for the list, then navigate
// to the item's hash via the Navigation API. The app should scroll the
// target row into view and select it.
// ---------------------------------------------------------------------------

test.describe('In-page hash navigation', () => {
  test.beforeEach(async ({page}) => {
    await gotoHomeAndWaitForRows(page, TIMEOUT);
    await waitForScrollStatePersisted(page);
  });

  test('first page item — scrolls and selects', async ({page}) => {
    const beta = TEST_ITEMS.find(i => i.title === 'Beta Item')!;
    await navigateToHash(page, beta.id);

    await waitForPermalinkRow(page, beta);
  });

  test('page-boundary item — scrolls and selects', async ({page}) => {
    const mid = TEST_ITEMS.find(i => i.title === 'Test Item 100')!;
    await navigateToHash(page, mid.id);

    await waitForPermalinkRow(page, mid);
  });

  test('last item — scrolls and selects', async ({page}) => {
    const last = TEST_ITEMS.find(i => i.title === 'Test Item 200')!;
    await navigateToHash(page, last.id);

    await waitForPermalinkRow(page, last);
  });
});

// ---------------------------------------------------------------------------
// Back / forward navigation and scroll restore: the virtualizer persists
// scroll state in history.state via the Navigation API. Navigating back
// or forward should restore the scroll position and visible rows.
// ---------------------------------------------------------------------------

test.describe('Back / forward and scroll restore', () => {
  test('back after hash nav restores scroll position at the top', async ({
    page,
  }) => {
    await gotoHomeAndWaitForRows(page, TIMEOUT);
    await expect(page.locator(`a[href="#${ALPHA.id}"]`)).toContainText(
      'Alpha Item',
    );

    // Wait for scroll state to be saved before navigating away.
    await waitForScrollStatePersisted(page);

    // Navigate to a far item (pushes a new history entry).
    const far = TEST_ITEMS.find(i => i.title === 'Test Item 100')!;
    await navigateToHash(page, far.id);
    await expect(page.locator(`a[href="#${far.id}"]`)).toBeVisible({
      timeout: TIMEOUT,
    });

    // Go back — should restore to the top with Alpha Item visible.
    await page.goBack();
    await expect(page.locator(`a[href="#${ALPHA.id}"]`)).toBeVisible({
      timeout: TIMEOUT,
    });
    await expect(page.locator(`a[href="#${ALPHA.id}"]`)).toContainText(
      'Alpha Item',
    );
  });

  test('forward after back restores the permalink position', async ({page}) => {
    await gotoHomeAndWaitForRows(page, TIMEOUT);

    // Wait for scroll state to be saved before navigating away.
    await waitForScrollStatePersisted(page);

    // Navigate to a far item.
    const far = TEST_ITEMS.find(i => i.title === 'Test Item 100')!;
    await navigateToHash(page, far.id);
    const farRow = page.locator(`a[href="#${far.id}"]`);
    await expect(farRow).toBeVisible({timeout: TIMEOUT});

    // Go back, then forward.
    await page.goBack();
    await expect(page.locator(`a[href="#${ALPHA.id}"]`)).toBeVisible({
      timeout: TIMEOUT,
    });

    await page.goForward();
    await page.waitForURL(`/#${far.id}`);
    await expect(async () => {
      await expect(farRow).toBeVisible();
      await expect(farRow).toHaveAttribute('aria-selected', 'true');
    }).toPass({timeout: TIMEOUT});
  });

  test('back restores a mid-list scroll position', async ({page}) => {
    await gotoHomeAndWaitForRows(page, TIMEOUT);

    // Scroll partway down — enough to see row ~20 but not the very top.
    await scrollToMidList(page, TIMEOUT);

    // Record which row is visible at the top of the viewport.
    const visibleRowHref = await topVisibleRowHref(page);

    // Wait for scroll state to be persisted (debounced at 100ms).
    await waitForScrollStatePersisted(page);

    // Navigate to a permalink (pushes new history entry).
    const far = TEST_ITEMS.find(i => i.title === 'Test Item 100')!;
    await navigateToHash(page, far.id);
    await expect(page.locator(`a[href="#${far.id}"]`)).toBeVisible({
      timeout: TIMEOUT,
    });

    // Go back — should restore the mid-list scroll position.
    await page.goBack();

    // The previously visible row should reappear near the same position.
    await expect(page.locator(`a[href="${visibleRowHref}"]`)).toBeVisible({
      timeout: TIMEOUT,
    });
  });

  test('reload restores the scroll position (not a blank viewport)', async ({
    page,
  }) => {
    await gotoHomeAndWaitForRows(page, TIMEOUT);

    // Scroll partway down so the top of the list is well off-screen.
    await scrollToMidList(page, TIMEOUT);

    // Record which row currently sits at the top of the viewport.
    const topRowHref = await topVisibleRowHref(page);
    expect(topRowHref).not.toBeNull();

    // Persist, then hard-reload.
    await waitForScrollStatePersisted(page);
    await page.reload();

    // The same row must be back in the viewport — `toBeInViewport` (not just
    // `toBeVisible`) catches the regression where the anchor is restored but the
    // scroll offset is not, leaving the viewport parked on the blank top padding.
    await expect(page.locator(`a[href="${topRowHref}"]`)).toBeInViewport({
      timeout: TIMEOUT,
    });
  });
});
