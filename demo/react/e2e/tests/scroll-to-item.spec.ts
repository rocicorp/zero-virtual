import {expect, test, type Page} from '@playwright/test';
import {TEST_ITEMS} from '../seed-test.ts';
import {
  ALPHA,
  VIEWPORT_SELECTOR,
  gotoHomeAndWaitForRows,
  navigateToHash,
  topVisibleRowHref,
  viewportHandle,
  waitForRows,
} from './helpers.ts';

const TIMEOUT = 20_000;

// Rows the initial page never loads: in the default sort (modified DESC) the
// list runs Alpha Item (tstitem001) → Test Item 200, and the first page is 50
// rows, so anything past ~50 needs its own page fetched.
const FAR = TEST_ITEMS.find(i => i.title === 'Test Item 180')!;
const OTHER_FAR = TEST_ITEMS.find(i => i.title === 'Test Item 120')!;
const NEAR = TEST_ITEMS.find(i => i.title === 'Test Item 020')!;

/** Fill the dev panel's scrollToItem field and press Jump. */
async function jumpTo(page: Page, id: string, align?: string) {
  if (align) {
    await page.getByLabel('scrollToItem align').selectOption(align);
  }
  await page.getByLabel('scrollToItem id').fill(id);
  await page.getByRole('button', {name: 'Jump'}).click();
}

/** The target row's offset from the top of the viewport, in px. */
function rowOffsetFromTop(page: Page, id: string): Promise<number | null> {
  return page.evaluate(
    ([sel, rowID]) => {
      const viewport = document.querySelector(sel as string);
      const row = document.querySelector(`a[href="#${rowID}"]`);
      if (!viewport || !row) return null;
      return Math.round(
        row.getBoundingClientRect().top - viewport.getBoundingClientRect().top,
      );
    },
    [VIEWPORT_SELECTOR, id] as const,
  );
}

/**
 * Wait until the viewport's scroll offset holds still — the jump has landed
 * and the pages around it have stopped streaming in.
 */
async function waitForScrollIdle(page: Page) {
  await page.evaluate(
    sel =>
      new Promise<void>(resolve => {
        const viewport = document.querySelector(sel);
        if (!viewport) {
          resolve();
          return;
        }
        let last = viewport.scrollTop;
        let stable = 0;
        const check = () => {
          if (viewport.scrollTop === last) {
            if (++stable >= 5) {
              resolve();
              return;
            }
          } else {
            stable = 0;
            last = viewport.scrollTop;
          }
          setTimeout(check, 100);
        };
        setTimeout(check, 100);
      }),
    VIEWPORT_SELECTOR,
  );
}

/** Everything about the list that a no-op jump must leave untouched. */
async function listState(page: Page) {
  const viewport = await viewportHandle(page);
  return {
    topRow: await topVisibleRowHref(page),
    rowCount: await page.locator(`${VIEWPORT_SELECTOR} a[href^="#"]`).count(),
    scrollTop: await viewport.evaluate(el => Math.round(el.scrollTop)),
  };
}

test.describe('scrollToItem', () => {
  test.beforeEach(async ({page}) => {
    await gotoHomeAndWaitForRows(page, TIMEOUT);
  });

  test('jumps to a row that is not loaded yet', async ({page}) => {
    await jumpTo(page, FAR.id, 'start');

    const row = page.locator(`a[href="#${FAR.id}"]`);
    await expect(row).toBeInViewport({timeout: TIMEOUT});
    await expect(row).toContainText(FAR.title);
  });

  test('align start puts the target at the top of the viewport', async ({
    page,
  }) => {
    await jumpTo(page, FAR.id, 'start');
    await expect(page.locator(`a[href="#${FAR.id}"]`)).toBeInViewport({
      timeout: TIMEOUT,
    });

    // Within a row's height of the viewport top (the list is still settling
    // its estimates as the neighbouring pages stream in).
    await expect(async () => {
      const offset = await rowOffsetFromTop(page, FAR.id);
      expect(offset).not.toBeNull();
      expect(Math.abs(offset!)).toBeLessThan(60);
    }).toPass({timeout: TIMEOUT});
  });

  test('align auto leaves a row that is already fully visible where it is', async ({
    page,
  }) => {
    // Alpha Item is the first row, on screen from the start.
    const before = await listState(page);

    await jumpTo(page, ALPHA.id, 'auto');
    await page.waitForTimeout(1_000);

    expect(await listState(page)).toEqual(before);
  });

  test('align auto scrolls a row below the viewport just into view', async ({
    page,
  }) => {
    await jumpTo(page, NEAR.id, 'auto');

    const row = page.locator(`a[href="#${NEAR.id}"]`);
    await expect(row).toBeInViewport({timeout: TIMEOUT});

    // "Just into view" — near the bottom edge, not the top.
    const viewportHeight = await (
      await viewportHandle(page)
    ).evaluate(el => el.clientHeight);
    const offset = await rowOffsetFromTop(page, NEAR.id);
    expect(offset).toBeGreaterThan(viewportHeight / 2);
  });

  test('jumping to the same id twice scrolls again', async ({page}) => {
    await jumpTo(page, FAR.id, 'start');
    await expect(page.locator(`a[href="#${FAR.id}"]`)).toBeInViewport({
      timeout: TIMEOUT,
    });
    await waitForScrollIdle(page);
    const atStart = await rowOffsetFromTop(page, FAR.id);
    expect(atStart).not.toBeNull();

    // The same id again — which a permalink, being edge-triggered, would
    // ignore. This one moves the viewport: the row goes from the top of it to
    // the bottom.
    await jumpTo(page, FAR.id, 'end');

    const height = await (
      await viewportHandle(page)
    ).evaluate(el => el.clientHeight);
    await expect(async () => {
      const offset = await rowOffsetFromTop(page, FAR.id);
      expect(offset).not.toBeNull();
      expect(offset!).toBeGreaterThan(height / 2);
    }).toPass({timeout: TIMEOUT});
  });

  test('a second jump while the first is still loading lands on the second', async ({
    page,
  }) => {
    // Watch for the second target from before the jumps: what this asserts is
    // that the second request wins, and the row it names is the one that ends
    // up loaded and in view. (It is not asserted to *stay* there: landing on a
    // cold window can leave the viewport at the window's edge, and paging then
    // tops it up from above — see the note in HACKING.md.)
    await page.evaluate(rowID => {
      const w = globalThis as unknown as {__seen: boolean};
      w.__seen = false;
      const check = () => {
        const row = document.querySelector(`a[href="#${rowID}"]`);
        if (!row) return;
        const box = row.getBoundingClientRect();
        if (box.bottom > 0 && box.top < window.innerHeight) w.__seen = true;
      };
      new MutationObserver(check).observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
      });
      addEventListener('scroll', check, {capture: true, passive: true});
    }, OTHER_FAR.id);

    await jumpTo(page, FAR.id, 'start');
    await jumpTo(page, OTHER_FAR.id, 'start');

    await expect
      .poll(
        () =>
          page.evaluate(
            () => (globalThis as unknown as {__seen: boolean}).__seen,
          ),
        {timeout: TIMEOUT},
      )
      .toBe(true);
  });

  test('an id that does not exist does nothing at all', async ({page}) => {
    const before = await listState(page);
    expect(before.rowCount).toBeGreaterThan(0);

    await jumpTo(page, 'does-not-exist-at-all', 'start');

    // Nothing to assert *happening*, so give the lookup time to come back and
    // then check the list is untouched: before the existence check this threw
    // the loaded window away and left the viewport permanently empty.
    await page.waitForTimeout(3_000);

    expect(await listState(page)).toEqual(before);
    await expect(page.locator(`a[href="#${ALPHA.id}"]`)).toBeVisible();
  });

  test('paging still works after an id that does not exist', async ({page}) => {
    await jumpTo(page, 'does-not-exist-at-all', 'start');
    await page.waitForTimeout(3_000);

    // A request left pending would stand paging down for the rest of the
    // session: scrolling to the end must still load the last page.
    const viewport = await viewportHandle(page);
    await expect(async () => {
      await viewport.evaluate(el => {
        el.scrollTop = el.scrollHeight;
      });
      await expect(
        page.locator(`a[href="#${TEST_ITEMS[TEST_ITEMS.length - 1].id}"]`),
      ).toBeVisible({timeout: 1_000});
    }).toPass({timeout: TIMEOUT});
  });

  test('a real id still lands after one that does not exist', async ({
    page,
  }) => {
    await jumpTo(page, 'does-not-exist-at-all', 'start');
    await page.waitForTimeout(2_000);

    await jumpTo(page, FAR.id, 'start');

    await expect(page.locator(`a[href="#${FAR.id}"]`)).toBeInViewport({
      timeout: TIMEOUT,
    });
  });
});

test.describe('window scrolling', () => {
  test('lands the row below the sticky header, not under it', async ({
    page,
  }) => {
    // The window-scrolled demo pins its header and declares the covered strip
    // with `scroll-padding-top`. A top-aligned jump has to respect that: the
    // row lands at the header's bottom edge, and is the first row you can
    // actually see. Without it the row lands at window top — behind the
    // header — and the list reads as scrolled one row too far.
    await page.goto('/?scroller=window');
    await expect(page.locator(`a[href="#${ALPHA.id}"]`)).toBeVisible({
      timeout: TIMEOUT,
    });

    await page.getByLabel('scrollToItem align').selectOption('start');
    await page.getByLabel('scrollToItem id').fill(FAR.id);
    await page.getByRole('button', {name: 'Jump'}).click();
    await expect(page.locator(`a[href="#${FAR.id}"]`)).toBeInViewport({
      timeout: TIMEOUT,
    });

    await expect(async () => {
      const landing = await page.evaluate(rowID => {
        const bar = document.querySelector('[class*="stickyBar"]')!;
        const row = document.querySelector(`a[href="#${rowID}"]`);
        return row
          ? Math.round(
              row.getBoundingClientRect().top -
                bar.getBoundingClientRect().bottom,
            )
          : null;
      }, FAR.id);
      expect(landing).not.toBeNull();
      expect(Math.abs(landing!)).toBeLessThan(4);
    }).toPass({timeout: TIMEOUT});
  });
});

test.describe('permalink to an id that does not exist', () => {
  test('leaves a list that is already on screen alone', async ({page}) => {
    await gotoHomeAndWaitForRows(page, TIMEOUT);
    const before = await listState(page);
    expect(before.rowCount).toBeGreaterThan(0);

    await navigateToHash(page, 'does-not-exist-at-all');
    await page.waitForTimeout(3_000);

    expect(await listState(page)).toEqual(before);
  });

  test('still shows the list on a cold load', async ({page}) => {
    // Nothing is loaded yet, so the anchor does go to the permalink — and
    // when the lookup comes back empty the list must fall back to the top
    // instead of sitting empty forever.
    await page.goto('/#does-not-exist-at-all');

    await waitForRows(page, TIMEOUT);
    await expect(page.locator(`a[href="#${ALPHA.id}"]`)).toBeVisible({
      timeout: TIMEOUT,
    });
  });
});
