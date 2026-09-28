import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS === 'true' ? '/paperbridge/' : '/',
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});

