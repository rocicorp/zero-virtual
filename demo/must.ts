export function must<T>(val: T, message = 'Expected value to be defined') {
  if (!val) {
    throw new Error(message);
  }
  return val;
}
