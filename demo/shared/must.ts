export function must<T>(
  val: T,
  message = 'Expected value to be defined',
): NonNullable<T> {
  if (val === undefined || val === null) {
    throw new Error(message);
  }
  return val;
}
