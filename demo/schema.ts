import {
  createBuilder,
  createSchema,
  number,
  type Row,
  string,
  table,
} from '@rocicorp/zero';

const item = table('item')
  .columns({
    id: string(),
    title: string(),
    description: string(),
    created: number(),
    modified: number(),
  })
  .primaryKey('id');

export const schema = createSchema({
  tables: [item],
  relationships: [],
});

export const zql = createBuilder(schema);

export type Schema = typeof schema;
export type Item = Row<typeof schema.tables.item>;

declare module '@rocicorp/zero' {
  interface DefaultTypes {
    schema: Schema;
  }
}
