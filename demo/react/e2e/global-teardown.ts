import {killExistingZeroCache} from './global-setup.ts';

export default async function globalTeardown(): Promise<void> {
  const pid = killExistingZeroCache();
  if (pid !== null) {
    console.log(`[teardown] Stopped zero-cache (pid ${pid})`);
  }
}
