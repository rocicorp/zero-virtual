/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_USER_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
