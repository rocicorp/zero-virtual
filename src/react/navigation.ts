interface NavigationHistoryEntry {
  readonly url: string | null;
  getState<T = unknown>(): T;
}

interface NavigationUpdateCurrentEntryOptions {
  state: unknown;
}

export interface Navigation extends EventTarget {
  readonly currentEntry: NavigationHistoryEntry | null;
  navigate(
    url: string,
    options?: {state?: unknown; info?: unknown; history?: string},
  ): unknown;
  updateCurrentEntry(options: NavigationUpdateCurrentEntryOptions): void;
}

declare const navigation: Navigation;

export function subscribeToNavigation(callback: () => void): () => void {
  navigation.addEventListener('currententrychange', callback);
  return () => {
    navigation.removeEventListener('currententrychange', callback);
  };
}

export function getNavigationState<T>(key: string): T | null {
  return (
    (navigation.currentEntry?.getState<Record<string, unknown>>()?.[
      key
    ] as T) ?? null
  );
}

export function setNavigationState<T>(key: string, value: T): void {
  navigation.updateCurrentEntry({
    state: {
      ...navigation.currentEntry?.getState<Record<string, unknown>>(),
      [key]: value,
    },
  });
}

const n = navigation;
export {n as navigation};
