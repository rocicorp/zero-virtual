import {existsSync, readFileSync, rmSync} from 'node:fs';
import {PID_FILE} from './global-setup.ts';

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(PID_FILE)) return;

  const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
  if (!isNaN(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`[teardown] Stopped zero-cache (pid ${pid})`);
    } catch {
      // Already gone — that's fine.
    }
  }
  rmSync(PID_FILE, {force: true});
}
