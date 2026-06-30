import {expect, test, type Page} from '@playwright/test';
import {TEST_ITEMS} from '../seed-test.ts';
import {
  ALPHA,
  VIEWPORT_SELECTOR,
  gotoHomeAndWaitForRows,
  viewportHandle,
} from './helpers.ts';

const TIMEOUT = 20_000;
const LAST = TEST_ITEMS[TEST_ITEMS.length - 1];

// Tolerance (px) for the permalink "settled and visible" check below. A relabel
// bug shifts content by a whole item (48px) or more, well outside this band.
const TOLERANCE = 24;

type RowRect = {href: string; top: number};

// Returns the rendered rows' href -> top (relative to the viewport top).
async function rowRects(page: Page): Promise<RowRect[]> {
  return page.evaluate(sel => {
    const vp = document.querySelector(sel);
    if (!vp) return [];
    const vpTop = vp.getBoundingClientRect().top;
    return [...vp.querySelectorAll('a[href^="#"]')]
      .map(a => ({
        href: a.getAttribute('href')!,
        top: a.getBoundingClientRect().top - vpTop,
      }))
      .filter(r => r.href);
  }, VIEWPORT_SELECTOR);
}

// Wait for any in-flight paging to settle: the rendered rows and their
// positions stop changing for two consecutive polls.
async function waitForStable(page: Page) {
  let prev = JSON.stringify(await rowRects(page));
  await expect(async () => {
    const cur = JSON.stringify(await rowRects(page));
    const stable = cur === prev;
    prev = cur;
    expect(stable).toBe(true);
  }).toPass({timeout: TIMEOUT, intervals: [80, 120, 160]});
}

// Sample a single row's viewport-relative top for `durationMs`. Returns the
// list of samples (null = row not currently rendered).
async function sampleRowTop(
  page: Page,
  id: string,
  durationMs: number,
): Promise<(number | null)[]> {
  return page.evaluate(
    async ({id, durationMs, sel}) => {
      const vp = document.querySelector(sel);
      if (!vp) return [];
      const out: (number | null)[] = [];
      const end = performance.now() + durationMs;
      while (performance.now() < end) {
        const a = document.querySelector(`a[href="#${id}"]`);
        out.push(
          a
            ? a.getBoundingClientRect().top - vp.getBoundingClientRect().top
            : null,
        );
        await new Promise(r => setTimeout(r, 50));
      }
      return out;
    },
    {id, durationMs, sel: VIEWPORT_SELECTOR},
  );
}

// ---------------------------------------------------------------------------
// Primary detector: permalink navigation to a deep item triggers a large
// backward page load (firstRowIndex << 0) and the corresponding index relabel.
// The target row is scrolled into view first, then must stay put while the
// before/after pages load. A relabel without scroll compensation jumps it.
// ---------------------------------------------------------------------------
test.describe('Scroll smoothness — permalink stability', () => {
  for (const title of ['Test Item 100', 'Test Item 200']) {
    test(`permalink to ${title} stays put while pages load`, async ({page}) => {
      const item = TEST_ITEMS.find(i => i.title === title)!;
      await page.goto(`/#${item.id}`);

      const row = page.locator(`a[href="#${item.id}"]`);
      await expect(row).toBeVisible({timeout: TIMEOUT});

      const samples = await sampleRowTop(page, item.id, 2500);

      // A single estimate->exact reposition right after the target first appears
      // is acceptable (the count is an estimate until pages load). What must NOT
      // happen is the target getting lost or continuously shifting: once paging
      // settles, the row must stay visible and pinned. A relabel without scroll
      // compensation throws the row out of the viewport (null) or leaves it
      // drifting — both show up in the converged tail.
      const tail = samples.slice(-10);
      expect(
        tail.every(s => s !== null),
        `target not stably visible at end: ${JSON.stringify(samples)}`,
      ).toBe(true);

      const tailNums = tail as number[];
      const spread = Math.max(...tailNums) - Math.min(...tailNums);
      expect(
        spread,
        `${title}: target not settled (tail spread ${spread.toFixed(
          0,
        )}px): ${JSON.stringify(samples)}`,
      ).toBeLessThanOrEqual(TOLERANCE);
    });
  }
});

// ---------------------------------------------------------------------------
// Secondary detector: scroll the whole list in small steps (both directions)
// and assert visible content moves in exact lockstep with the scroll input —
// "scroll by N px, content moves N px", except where the scroll is clamped at
// an end. Any larger move is a content jump.
// ---------------------------------------------------------------------------

// Honour the user's definition closely: small steps, tight tolerance. A relabel
// that fails to compensate shifts content by a whole row (48px) or more, far
// outside this band; LOCKSTEP_TOLERANCE only absorbs sub-pixel rounding.
const LOCKSTEP_STEP = 40;
const LOCKSTEP_TOLERANCE = 3;

// Scroll `vp` by `commanded` px (signed) and assert every row rendered both
// before and after moved by exactly -commanded px (content moves opposite to
// the scroll). Returns the actual signed scrollTop change so the caller can
// detect the end clamp. Records any violations into `jumps`.
async function stepAndCheck(
  page: Page,
  vp: Awaited<ReturnType<typeof viewportHandle>>,
  commanded: number,
  jumps: string[],
  label: string,
) {
  const before = await rowRects(page);
  const top0 = await vp.evaluate(el => el.scrollTop);
  await vp.evaluate((el, step) => {
    el.scrollTop = Math.max(0, Math.min(el.scrollHeight, el.scrollTop + step));
  }, commanded);
  await waitForStable(page);
  const top1 = await vp.evaluate(el => el.scrollTop);
  const actualScroll = top1 - top0;

  const after = await rowRects(page);
  const afterByHref = new Map(after.map(r => [r.href, r.top]));
  for (const b of before) {
    const a = afterByHref.get(b.href);
    if (a === undefined) continue;
    const moved = a - b.top;
    // Content should move opposite to the *commanded* scroll. Near an end the
    // scroll is clamped, so fall back to the actual scroll delta there.
    const expected = -commanded;
    const clampExpected = -actualScroll;
    const drift = Math.min(
      Math.abs(moved - expected),
      Math.abs(moved - clampExpected),
    );
    if (drift > LOCKSTEP_TOLERANCE) {
      jumps.push(
        `${label}: row ${b.href} moved ${moved.toFixed(
          1,
        )}px for a ${commanded}px scroll (actualScroll ${actualScroll.toFixed(
          1,
        )}, drift ${drift.toFixed(1)}px)`,
      );
    }
  }
  return actualScroll;
}

test.describe('Scroll smoothness — continuous scroll', () => {
  test('content tracks the scroll exactly while scrolling down then up', async ({
    page,
  }) => {
    await gotoHomeAndWaitForRows(page, TIMEOUT);

    const vp = await viewportHandle(page);
    await waitForStable(page);

    const jumps: string[] = [];

    // Scroll all the way down, one small step at a time.
    for (let i = 0; i < 400; i++) {
      const moved = await stepAndCheck(
        page,
        vp,
        LOCKSTEP_STEP,
        jumps,
        `down#${i}`,
      );
      const atBottom = await vp.evaluate(
        el => el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
      );
      if (atBottom && moved < 1) break;
    }
    await expect(page.locator(`a[href="#${LAST.id}"]`)).toBeVisible({
      timeout: TIMEOUT,
    });

    // Scroll all the way back up.
    for (let i = 0; i < 400; i++) {
      const moved = await stepAndCheck(
        page,
        vp,
        -LOCKSTEP_STEP,
        jumps,
        `up#${i}`,
      );
      const atTop = await vp.evaluate(el => el.scrollTop <= 0);
      if (atTop && moved > -1) break;
    }
    await expect(page.locator(`a[href="#${ALPHA.id}"]`)).toBeVisible({
      timeout: TIMEOUT,
    });

    expect(
      jumps,
      `content jumps detected (${jumps.length}):\n${jumps
        .slice(0, 20)
        .join('\n')}`,
    ).toEqual([]);
  });
});
