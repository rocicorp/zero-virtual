import {expect, test} from 'vitest';
import {valueKey} from './value-key.ts';

test('bigints are represented rather than thrown over', () => {
  expect(valueKey({rowid: 1n})).not.toEqual(valueKey({rowid: 2n}));
  expect(valueKey({rowid: 1n})).toEqual(valueKey({rowid: 1n}));
});

test('a cycle degrades to a shallow key instead of throwing', () => {
  const cyclic: Record<string, unknown> = {a: 1};
  cyclic.self = cyclic;
  expect(() => valueKey(cyclic)).not.toThrow();
});

test('a value that cannot be coerced at all still keys', () => {
  // A cycle forces the fallback, and a null-prototype member has no toString
  // for it to call — so the fallback has to survive its own coercion.
  const cyclic: Record<string, unknown> = {a: Object.create(null)};
  cyclic.self = cyclic;
  expect(() => valueKey(cyclic)).not.toThrow();
});
