import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';

const directory=(path:string)=>fileURLToPath(new URL(path,import.meta.url));

export default defineConfig({
  root: directory('./'),
  envDir: false,
  plugins: [react()],
  server: {
    port: 5173, strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3000' },
    fs: {
      allow: [directory('./'),directory('../shared'),directory('../node_modules')],
      deny: ['.env', '.env.*', '**/local-data/**', '**/*.sqlite3*', '**/*.dpapi', '**/*.pem', '**/*.key', '**/.git/**']
    }
  },
  build: { outDir: 'dist', emptyOutDir: true }
});
