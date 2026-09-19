/**
 * A value, as a string that changes when the value does.
 *
 * Used wherever this library has to tell one piece of the *app's* own data
 * from another — paging anchors, list-context params, persisted scroll state.
 * That data reaches us through channels wider than JSON: the Navigation API
 * structured-clones, so an int64 column read as a `bigint` stores and restores
 * perfectly well, and only the comparison in the middle would throw over it.
 *
 * So bigints are spelled out rather than thrown over, and anything left that
 * JSON still can't take (a cycle, say) degrades to a shallow key over the
 * value's own entries instead of taking the caller down with it. The cost of
 * that last fallback is only that two values differing solely below the top
 * level read as unchanged.
 */
export function valueKey(value: unknown): string {
  try {
    return JSON.stringify(value, replaceBigint) ?? String(value);
  } catch {
    if (typeof value !== 'object' || value === null) return String(value);
    return Object.entries(value)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(',');
  }
}

function replaceBigint(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? `${value}n` : value;
}
