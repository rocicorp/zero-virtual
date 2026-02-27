export function assert(
  b: unknown,
  msg: string | (() => string) = 'Assertion failed',
): asserts b {
  if (!b) {
    throw new Error(typeof msg === 'string' ? msg : msg());
  }
}

export function unreachable(): never;
export function unreachable(v: never): never;
export function unreachable(_?: never): never {
  throw new Error('Unreachable');
}
