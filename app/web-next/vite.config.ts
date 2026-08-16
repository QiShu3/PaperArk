import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3001',
      '/rawPDF': 'http://localhost:3001',
      '/MD': 'http://localhost:3001',
    },
    watch: {
      // 忽略原子写入产生的临时目录（`.xxx.tmpdir`），避免 Windows 下 EBUSY 崩溃
      ignored: ['**/.*.tmpdir/**'],
    },
  },
});
