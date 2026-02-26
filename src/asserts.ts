export function assert(
  b: unknown,
  msg: string | (() => string) = 'Assertion failed',
): asserts b {
  if (!b) {
    throw new Error(typeof msg === 'string' ? msg : msg());
  }
}
