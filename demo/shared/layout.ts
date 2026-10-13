/**
 * The demos' layouts — a list, or a grid or masonry of N columns — as URL
 * parameters (`?lanes=N`, plus `&masonry=1`) and as the dev panel's layout
 * select values (`list`, `grid-N`, `masonry-N`).
 */
export type Layout = {lanes: number; masonry: boolean};

/**
 * The `?lanes=` column count: a whole number of at least 1. Anything else —
 * `Infinity`, a negative, text — falls back to a plain list.
 */
export function parseLanes(value: string): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** The layout the URL parameters describe. */
export function layoutFromParams(lanes: string, masonry: string): Layout {
  const n = parseLanes(lanes);
  return {lanes: n, masonry: n > 1 && masonry === '1'};
}

/** The URL parameters for a layout select value (`null` removes one). */
export function paramsForLayout(value: string): {
  lanes: string | null;
  masonry: string | null;
} {
  const [kind, n = ''] = value.split('-');
  const lanes = kind === 'list' ? 1 : parseLanes(n);
  return {
    lanes: lanes === 1 ? null : String(lanes),
    masonry: lanes > 1 && kind === 'masonry' ? '1' : null,
  };
}

/** The layout select value for a layout. */
export function layoutValue({lanes, masonry}: Layout): string {
  return lanes === 1 ? 'list' : `${masonry ? 'masonry' : 'grid'}-${lanes}`;
}

/**
 * The layout select's choices, as `[value, label]`: a list, then grids and
 * masonry of 2 to 4 columns — plus the current one, if the URL asked for a
 * wider one.
 */
export function layoutChoices(current: string): Array<[string, string]> {
  const choices: Array<[string, string]> = [['list', 'List']];
  for (const kind of ['grid', 'masonry'] as const) {
    for (let n = 2; n <= 4; n++) choices.push([`${kind}-${n}`, label(kind, n)]);
  }
  if (!choices.some(([value]) => value === current)) {
    const [kind, n] = current.split('-');
    choices.push([current, label(kind === 'masonry' ? kind : 'grid', +n)]);
  }
  return choices;
}

function label(kind: 'grid' | 'masonry', n: number): string {
  return `${kind === 'grid' ? 'Grid' : 'Masonry'} · ${n} columns`;
}
