/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_USER_ID: string;
  readonly VITE_PUBLIC_ZERO_CACHE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
