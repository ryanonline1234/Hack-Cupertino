/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Override Streets.GL deployment URL (default: https://streets-gl.pages.dev) */
  readonly VITE_STREETS_GL_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
