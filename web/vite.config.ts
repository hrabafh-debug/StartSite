import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = `http://127.0.0.1:${process.env.STARTSITE_PORT || 4500}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 4501,
    strictPort: true,
    proxy: { '/api': { target: api, changeOrigin: false } },
  },
});
