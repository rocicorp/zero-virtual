import {mustGetMutator, mustGetQuery} from '@rocicorp/zero';
import {handleMutateRequest, handleQueryRequest} from '@rocicorp/zero/server';
import {zeroNodePg} from '@rocicorp/zero/server/adapters/pg';
import {Hono} from 'hono';
import {Pool} from 'pg';
import {assert} from '../../src/asserts.ts';
import {mutators} from '../mutators.ts';
import {queries} from '../queries.ts';
import {schema} from '../schema.ts';

export const config = {
  runtime: 'nodejs',
};

export const app = new Hono().basePath('/api');

const {ZERO_UPSTREAM_DB} = process.env;

assert(ZERO_UPSTREAM_DB, 'ZERO_UPSTREAM_DB environment variable is required');

const pool = new Pool({
  connectionString: ZERO_UPSTREAM_DB,
});
const dbProvider = zeroNodePg(schema, pool);

app.post('/zero/query', async c => {
  const result = await handleQueryRequest(
    (name, args) => mustGetQuery(queries, name).fn({args, ctx: {}}),
    schema,
    c.req.raw,
  );
  return c.json(result);
});

app.post('/zero/mutate', async c => {
  const result = await handleMutateRequest(
    dbProvider,
    transact =>
      transact((tx, name, args) =>
        mustGetMutator(mutators, name).fn({tx, args, ctx: {}}),
      ),
    c.req.raw,
  );
  return c.json(result);
});

app.get('/zero/inspect', c => {
  return c.json({
    queries: Object.keys(queries.item),
    mutators: Object.keys(mutators.item),
  });
});

export default app;
