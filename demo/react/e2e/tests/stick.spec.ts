import {expect, test, type Page} from '@playwright/test';
import {viewportHandle, waitForRows} from './helpers.ts';

const TIMEOUT = 20_000;

// Distance (px) from the bottom edge; 0-ish when pinned.
function bottomGap(page: Page): Promise<number> {
  return page.evaluate(() => {
    const vp = document.querySelector('[class*="viewport"]')!;
    return vp.scrollHeight - vp.scrollTop - vp.clientHeight;
  });
}

// Grow the rows' content wrapper by `px`, standing in for content growth the
// virtualizer doesn't announce (e.g. the last row streaming in taller). The
// stick-to-bottom ResizeObserver on the wrapper must pick it up on its own.
function growContent(page: Page, px: number): Promise<void> {
  return page.evaluate(px => {
    const wrapper = document.querySelector('[data-vrow-index]')!
      .parentElement as HTMLElement;
    const current = parseFloat(getComputedStyle(wrapper).paddingBottom) || 0;
    wrapper.style.paddingBottom = `${current + px}px`;
  }, px);
}

test.describe('Stick to bottom', () => {
  test('follows growth at the bottom only while parked there', async ({
    page,
  }) => {
    // Exact count for a stable scrollbar, so the jump to the bottom lands at
    // the true end instead of chasing a growing estimate.
    await page.goto('/?follow=bottom&count=200');
    await waitForRows(page, TIMEOUT);

    // Park at the bottom and wait for paging to settle there: the scrollable
    // extent stops changing (the last page loaded, the bottom space
    // collapsed) across consecutive polls.
    const vp = await viewportHandle(page);
    let prevHeight = -1;
    await expect(async () => {
      const height = await vp.evaluate(el => {
        el.scrollTop = el.scrollHeight;
        return el.scrollHeight;
      });
      const stable = height === prevHeight;
      prevHeight = height;
      expect(stable).toBe(true);
      expect(await bottomGap(page)).toBeLessThanOrEqual(1);
    }).toPass({timeout: TIMEOUT, intervals: [100, 150, 200]});

    // Content grows at the bottom → the viewport must follow, purely via the
    // wrapper ResizeObserver (no virtualizer content tick involved).
    await growContent(page, 200);
    await expect(async () => {
      expect(await bottomGap(page)).toBeLessThanOrEqual(1);
    }).toPass({timeout: TIMEOUT});

    // Scroll away → unstuck: further growth must not yank the viewport.
    const before = await vp.evaluate(el => (el.scrollTop -= 400));
    await growContent(page, 200);
    // Give a re-pin (if any, wrongly) time to land.
    await page.waitForTimeout(250);
    const after = await vp.evaluate(el => el.scrollTop);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);

    // Scroll back to the bottom → re-arms and follows again. Let the scroll
    // event's stuckness measure land (it reads live geometry, so growing in
    // the same frame would read as "not at the bottom") before growing.
    await vp.evaluate(el => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(async () => {
      expect(await bottomGap(page)).toBeLessThanOrEqual(1);
    }).toPass({timeout: TIMEOUT});
    await page.waitForTimeout(100);
    await growContent(page, 200);
    await expect(async () => {
      expect(await bottomGap(page)).toBeLessThanOrEqual(1);
    }).toPass({timeout: TIMEOUT});
  });
});
