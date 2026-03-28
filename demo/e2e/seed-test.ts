import pg from 'pg';

// Fixed base timestamp: 2023-11-14T22:13:20.000Z
const BASE = 1_700_000_000_000;
const H = 3_600_000; // 1 hour in ms

export type TestItem = {
  id: string;
  title: string;
  description: string;
  created: number;
  modified: number;
};

// Items are ordered such that created and modified are inverses of each other:
//
//   modified DESC (default): Alpha, Beta, Gamma, ..., Kappa
//   modified ASC:            Kappa, Iota, Theta, ..., Alpha
//   created  DESC:           Kappa, Iota, Theta, ..., Alpha
//   created  ASC:            Alpha, Beta,  Gamma, ..., Kappa
//
// This gives 4 distinct, predictable orderings to test sorting.
export const TEST_ITEMS: TestItem[] = [
  {
    id: 'tstitem001',
    title: 'Alpha Item',
    description: 'Alpha test item description.',
    created: BASE + 1 * H,
    modified: BASE + 10 * H,
  },
  {
    id: 'tstitem002',
    title: 'Beta Item',
    description: 'Beta test item description.',
    created: BASE + 2 * H,
    modified: BASE + 9 * H,
  },
  {
    id: 'tstitem003',
    title: 'Gamma Item',
    description: 'Gamma test item description.',
    created: BASE + 3 * H,
    modified: BASE + 8 * H,
  },
  {
    id: 'tstitem004',
    title: 'Delta Item',
    description: 'Delta test item description.',
    created: BASE + 4 * H,
    modified: BASE + 7 * H,
  },
  {
    id: 'tstitem005',
    title: 'Epsilon Item',
    description: 'Epsilon test item description.',
    created: BASE + 5 * H,
    modified: BASE + 6 * H,
  },
  {
    id: 'tstitem006',
    title: 'Zeta Item',
    description: 'Zeta test item description.',
    created: BASE + 6 * H,
    modified: BASE + 5 * H,
  },
  {
    id: 'tstitem007',
    title: 'Eta Item',
    description: 'Eta test item description.',
    created: BASE + 7 * H,
    modified: BASE + 4 * H,
  },
  {
    id: 'tstitem008',
    title: 'Theta Item',
    description: 'Theta test item description.',
    created: BASE + 8 * H,
    modified: BASE + 3 * H,
  },
  {
    id: 'tstitem009',
    title: 'Iota Item',
    description: 'Iota test item description.',
    created: BASE + 9 * H,
    modified: BASE + 2 * H,
  },
  {
    id: 'tstitem010',
    title: 'Kappa Item',
    description: 'Kappa test item description.',
    created: BASE + 10 * H,
    modified: BASE + 1 * H,
  },
];

export async function seedTestDb(connectionString: string): Promise<void> {
  const pool = new pg.Pool({connectionString});
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Drop any stale logical replication slots so zero-cache can start fresh.
    await client.query(`
      SELECT pg_drop_replication_slot(slot_name)
      FROM pg_replication_slots
      WHERE slot_type = 'logical'
    `);

    await client.query('DROP TABLE IF EXISTS item CASCADE');
    await client.query(`
      CREATE TABLE item (
        id VARCHAR PRIMARY KEY,
        title VARCHAR NOT NULL,
        description VARCHAR NOT NULL,
        created FLOAT8 NOT NULL,
        modified FLOAT8 NOT NULL
      )
    `);

    for (const item of TEST_ITEMS) {
      await client.query(
        `INSERT INTO item (id, title, description, created, modified)
         VALUES ($1, $2, $3, $4, $5)`,
        [item.id, item.title, item.description, item.created, item.modified],
      );
    }

    await client.query('COMMIT');
    console.log(`Seeded ${TEST_ITEMS.length} test items`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}
