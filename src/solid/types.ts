import type {ScrollAdapter} from '../core/scroll-adapter.ts';

export type StickOptions = {
  /** Turn the behavior on/off. Defaults to `true`. */
  enabled?: boolean | undefined;
  /** Px of slack around the edge. */
  slack?: number | undefined;
  /** The same adapter the virtualizer uses (element by default). */
  adapter?: ScrollAdapter | undefined;
};
