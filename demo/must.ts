export function must<T>(val: T) {
  if (!val) {
    throw new Error('Expected value to be defined');
  }
  return val;
}
