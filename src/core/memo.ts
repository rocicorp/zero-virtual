/** Cache the last result by argument identity, without inspecting row data. */
export function memo<Args extends unknown[], Result>(
  compute: (...args: Args) => Result,
): (...args: Args) => Result {
  let previous: Args | undefined;
  let result: Result;
  return (...args) => {
    const cached = previous;
    if (!cached || args.some((arg, i) => arg !== cached[i])) {
      result = compute(...args);
      previous = args;
    }
    return result;
  };
}
