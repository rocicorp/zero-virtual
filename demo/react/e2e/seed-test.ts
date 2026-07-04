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

// Named items (1–10): Alpha through Kappa.
//
// Within this group created and modified are inverses of each other.
// Within the extra group they are also inverses.
// This means all four sort orderings produce a distinct first row:
//
//   modified DESC (default) → Alpha Item     (modified = BASE+10H, highest)
//   modified ASC            → Test Item 200  (modified = BASE−190H, lowest)
//   created  DESC           → Kappa Item     (created  = BASE+10H, highest)
//   created  ASC            → Test Item 011  (created  = BASE−190H, lowest)
//
// The 200 items also give the virtualizer enough rows to exercise paging
// (the min page size in the demo is 100).
const NAMED: TestItem[] = [
  {
    id: 'tstitem001',
    title: 'Alpha Item',
    description: 'Alpha test item.',
    created: BASE + 1 * H,
    modified: BASE + 10 * H,
  },
  {
    id: 'tstitem002',
    title: 'Beta Item',
    description: 'Beta test item.',
    created: BASE + 2 * H,
    modified: BASE + 9 * H,
  },
  {
    id: 'tstitem003',
    title: 'Gamma Item',
    description: 'Gamma test item.',
    created: BASE + 3 * H,
    modified: BASE + 8 * H,
  },
  {
    id: 'tstitem004',
    title: 'Delta Item',
    description: 'Delta test item.',
    created: BASE + 4 * H,
    modified: BASE + 7 * H,
  },
  {
    id: 'tstitem005',
    title: 'Epsilon Item',
    description: 'Epsilon test item.',
    created: BASE + 5 * H,
    modified: BASE + 6 * H,
  },
  {
    id: 'tstitem006',
    title: 'Zeta Item',
    description: 'Zeta test item.',
    created: BASE + 6 * H,
    modified: BASE + 5 * H,
  },
  {
    id: 'tstitem007',
    title: 'Eta Item',
    description: 'Eta test item.',
    created: BASE + 7 * H,
    modified: BASE + 4 * H,
  },
  {
    id: 'tstitem008',
    title: 'Theta Item',
    description: 'Theta test item.',
    created: BASE + 8 * H,
    modified: BASE + 3 * H,
  },
  {
    id: 'tstitem009',
    title: 'Iota Item',
    description: 'Iota test item.',
    created: BASE + 9 * H,
    modified: BASE + 2 * H,
  },
  {
    id: 'tstitem010',
    title: 'Kappa Item',
    description: 'Kappa test item.',
    created: BASE + 10 * H,
    modified: BASE + 1 * H,
  },
];

// Extra items (11–200): programmatically generated with inverted
// created/modified so the extremes are Test Item 011 and Test Item 200.
//
//   i=11:  created = BASE−190H (lowest created), modified = BASE−1H
//   i=200: created = BASE−1H,  modified = BASE−190H (lowest modified)
const EXTRA: TestItem[] = Array.from({length: 190}, (_, k) => {
  const i = k + 11; // 11..200
  const n = String(i).padStart(3, '0');
  return {
    id: `tstitem${n}`,
    title: `Test Item ${n}`,
    description: `Test item ${n} description.`,
    created: BASE - (201 - i) * H,
    modified: BASE - (i - 10) * H,
  };
});

export const TEST_ITEMS: TestItem[] = [...NAMED, ...EXTRA];

export async function seedTestDb(connectionString: string): Promise<void> {
  const pool = new pg.Pool({connectionString});
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Drop stale logical replication slots so zero-cache can start fresh.
    // Terminate any backends using the slots first, then drop them.
    await client.query(`
      SELECT pg_terminate_backend(active_pid)
      FROM pg_replication_slots
      WHERE slot_type = 'logical' AND active
    `);
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
