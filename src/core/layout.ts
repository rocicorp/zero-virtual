import type {RowsSnapshot} from './rows.ts';
import type {RowKey} from './types.ts';

/**
 * A layout plugged into the virtualizer with the `layout` option places the
 * loaded rows itself, instead of the list's flow between two spacers: it
 * names each row's lane, sizes the content after every render, and keeps the
 * rows on screen in place — so with a layout the virtualizer always anchors
 * manually, through the layout, and `anchoring` is ignored.
 *
 * {@linkcode masonryLayout} is one. A layout is a factory so that its code
 * is only bundled where it's imported.
 */
export type LayoutFactory = (host: LayoutHost) => Layout;

/** See {@linkcode LayoutFactory}. */
export interface Layout {
  /**
   * The lane of each loaded row, as {@linkcode VirtualRow.lane}. The same
   * function as long as nothing changed: the snapshot is rebuilt when it's
   * another.
   */
  lanes(): (index: number, key: RowKey) => number;
  /**
   * After every render, before paint: measure the rows, keep what's on
   * screen in place, and size the content for what's not loaded.
   */
  afterRender(): void;
  /**
   * What a restore needs to put the rows back where they were, saved in the
   * scroll state as {@linkcode ScrollHistoryState.layout}. Serializable.
   */
  save(): unknown;
  /** Bumped whenever {@linkcode Layout.save} would return something new. */
  readonly version: number;
  /**
   * A restore: `state` is what {@linkcode Layout.save} returned, from this
   * or any earlier version of the app, or `undefined` when nothing was saved.
   */
  restore(state: unknown): void;
}

/**
 * What a {@linkcode Layout} sees of the virtualizer it's plugged into. The
 * DOM members are only there while attached, which the layout only runs
 * while.
 */
export interface LayoutHost {
  /** The loaded rows. */
  readonly rows: RowsSnapshot<unknown>;
  /**
   * The loaded rows' keys as strings, in list order. The same array as long
   * as the rows are.
   */
  readonly keys: readonly string[];
  /** The `lanes` option: at least 1. */
  readonly lanes: number;
  /** The `listContextParams` option. */
  readonly listContextParams: unknown;
  /** The estimated height of a row not rendered (`estimateSize`). */
  readonly estimate: number;
  /** The estimated number of rows in the list. */
  readonly estimatedTotal: number;
  /** Whether the loaded rows answer the query as it is now, completely. */
  readonly settled: boolean;
  /** Whether a scroll to a row, or a restore, is landing. */
  readonly landing: boolean;
  /** The element the rows are rendered into. */
  readonly el: HTMLElement;
  /** The viewport's top, in client coordinates, and its height. */
  readonly viewportTop: number;
  readonly viewportHeight: number;
  /** The live scrollTop. Reading it forces layout. */
  readonly scrollTop: number;
  /**
   * scrollTop as the last scroll event reported it, or the last scroll write
   * asked for. Nothing may read layout before the content is sized for what
   * a render removed, or the browser clamps the viewport to content that is
   * short for a moment: until then, this is the position.
   */
  readonly reportedScrollTop: number;
  /**
   * A correction owed to scrollTop but held in a margin, during a touch
   * gesture (see {@linkcode LayoutHost.compensate}).
   */
  readonly pendingJump: number;
  /**
   * Where a restore in flight is taking scrollTop, or null. A layout that
   * moves all of its content moves this with it.
   */
  restoreScrollTop: number | null;
  /**
   * Scroll by `delta` so that what's on screen stays where it is — held in
   * a margin until the gesture ends, during a touch scroll.
   */
  compensate(delta: number): void;
  /** Render again, before paint. */
  rerender(): void;
}
