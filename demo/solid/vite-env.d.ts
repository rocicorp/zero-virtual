/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_USER_ID: string;
  readonly VITE_PUBLIC_CACHE_PORT: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
