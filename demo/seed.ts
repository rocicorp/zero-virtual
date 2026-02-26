import {faker} from '@faker-js/faker';
import pg from 'pg';
import {must} from './must.ts';

const ITEM_COUNT = 5_000;

const pool = new pg.Pool({
  connectionString: must(process.env.ZERO_UPSTREAM_DB),
});

const now = Date.now();

const items = Array.from({length: ITEM_COUNT}, (_, i) => {
  const created =
    now - faker.number.int({min: 0, max: 365 * 24 * 60 * 60 * 1000});
  const modified =
    created + faker.number.int({min: 0, max: 7 * 24 * 60 * 60 * 1000});
  return {
    id: faker.string.nanoid(10),
    title: faker.lorem.words({min: 2, max: 6}),
    description: faker.lorem.sentences({min: 1, max: 4}),
    created,
    modified: Math.min(modified, now - i), // ensure unique ordering
  };
});

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(`
    CREATE TABLE IF NOT EXISTS item (
      id VARCHAR PRIMARY KEY,
      title VARCHAR NOT NULL,
      description VARCHAR NOT NULL,
      created FLOAT8 NOT NULL,
      modified FLOAT8 NOT NULL
    )
  `);
  for (const item of items) {
    await client.query(
      `INSERT INTO item (id, title, description, created, modified) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [item.id, item.title, item.description, item.created, item.modified],
    );
  }
  await client.query('COMMIT');
  console.log(`Inserted ${ITEM_COUNT} items`);
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();
  await pool.end();
}
