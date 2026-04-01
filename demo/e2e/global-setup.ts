import {spawn} from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import * as net from 'node:net';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {seedTestDb} from './seed-test.ts';

const DEMO_DIR = fileURLToPath(new URL('..', import.meta.url));

// Replica dir is wiped on each run so zero-cache starts with clean data.
const REPLICA_DIR = '/tmp/zero-playwright-replica';
export const REPLICA_FILE = join(REPLICA_DIR, 'replica');

// PID file lets globalTeardown kill the zero-cache process.
export const PID_FILE = '/tmp/zero-playwright.pid';

export default async function globalSetup(): Promise<void> {
  console.log('\n[setup] Starting postgres...');
  await startPostgres();

  console.log('[setup] Waiting for postgres...');
  await waitForPort(5430);
  await waitForPostgres();

  console.log('[setup] Seeding test data...');
  await seedTestDb(process.env['ZERO_UPSTREAM_DB']!);

  console.log('[setup] Clearing zero-cache replica...');
  killExistingZeroCache();
  if (existsSync(REPLICA_DIR)) {
    rmSync(REPLICA_DIR, {recursive: true, force: true});
  }
  mkdirSync(REPLICA_DIR, {recursive: true});

  const port = Number(process.env['VITE_PUBLIC_CACHE_PORT'] ?? 5858);
  console.log('[setup] Starting zero-cache...');
  const zeroCacheProc = spawnZeroCache(port);
  writeFileSync(PID_FILE, String(zeroCacheProc.pid));

  console.log(`[setup] Waiting for zero-cache on port ${port}...`);
  await waitForPort(port, 60_000);
  console.log('[setup] Ready.\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function startPostgres(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      'docker',
      [
        'compose',
        '--env-file',
        '.env',
        '-f',
        './docker/docker-compose.yml',
        'up',
        '-d',
      ],
      {cwd: DEMO_DIR, stdio: 'inherit'},
    );
    proc.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`docker compose up exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

async function waitForPostgres(timeoutMs = 30_000): Promise<void> {
  const connStr = process.env['ZERO_UPSTREAM_DB']!;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const pool = new pg.Pool({connectionString: connStr, max: 1});
      const client = await pool.connect();
      client.release();
      await pool.end();
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error('Postgres not ready within timeout');
}

function waitForPort(port: number, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function tryConnect() {
      const socket = new net.Socket();
      socket.setTimeout(1_000);

      socket.on('connect', () => {
        socket.destroy();
        resolve();
      });

      const retry = () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Port ${port} not available after ${timeoutMs}ms`));
          return;
        }
        setTimeout(tryConnect, 500);
      };

      socket.on('timeout', retry);
      socket.on('error', retry);
      socket.connect(port, '127.0.0.1');
    }

    tryConnect();
  });
}

function spawnZeroCache(port: number) {
  const binDir = join(DEMO_DIR, 'node_modules', '.bin');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Ensure node_modules/.bin is on PATH so zero-cache-dev can find zero-cache.
    PATH: `${binDir}:${process.env['PATH'] ?? ''}`,
    ZERO_REPLICA_FILE: REPLICA_FILE,
    ZERO_LOG_LEVEL: 'error',
  };

  // Prefer the local bin so we use the exact version pinned in demo/package.json.
  const bin = join(DEMO_DIR, 'node_modules', '.bin', 'zero-cache-dev');
  const command = existsSync(bin) ? bin : 'zero-cache-dev';

  const proc = spawn(command, ['--port', String(port)], {
    cwd: DEMO_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  proc.stdout?.on('data', (d: Buffer) =>
    process.stdout.write(`[zero-cache] ${d}`),
  );
  proc.stderr?.on('data', (d: Buffer) =>
    process.stderr.write(`[zero-cache] ${d}`),
  );

  proc.on('exit', code => {
    if (code !== null && code !== 0) {
      console.error(`[zero-cache] exited with code ${code}`);
    }
  });

  proc.unref();
  return proc;
}

function killExistingZeroCache(): void {
  if (!existsSync(PID_FILE)) return;
  const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
  if (!isNaN(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process may already be gone — that's fine.
    }
  }
  rmSync(PID_FILE, {force: true});
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
