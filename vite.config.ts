import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3000' }, fs: { deny: ['.env', '.env.*', '**/local-data/**', '**/*.sqlite3*', '**/*.dpapi', '**/*.pem', '**/*.key', '**/.git/**'] } },
  build: { outDir: 'dist/web', emptyOutDir: true }
});
