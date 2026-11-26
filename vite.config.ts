import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** The version in package.json, which the About box shows: see src/model/version.ts. */
const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Relative asset paths, so the built page loads from file:// inside Electron.
  base: './',
  server: { port: 5183 },
  build: { chunkSizeWarningLimit: 1200 },
});
