/**
 * Set several URL query parameters in one replace navigation (`null` removes
 * one). The replace keeps the entry's state, so the virtualizer's saved
 * scroll position survives it, and setting the parameters together means
 * whatever reads them sees one change rather than one per parameter.
 */
export function setUrlParams(updates: Record<string, string | null>): void {
  const params = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  const search = params.toString();
  const url = location.pathname + (search ? `?${search}` : '') + location.hash;
  navigation.navigate(url, {
    history: 'replace',
    state: navigation.currentEntry?.getState(),
  });
}
