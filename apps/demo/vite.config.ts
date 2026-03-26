import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/siem': { target: 'http://localhost:3010', rewrite: (p) => p.replace(/^\/api\/siem/, ''), changeOrigin: true },
      '/api/ucp': { target: 'http://localhost:3011', rewrite: (p) => p.replace(/^\/api\/ucp/, ''), changeOrigin: true },
      '/api/ap2': { target: 'http://localhost:3012', rewrite: (p) => p.replace(/^\/api\/ap2/, ''), changeOrigin: true },
      '/api/timeline': { target: 'http://localhost:3013', rewrite: (p) => p.replace(/^\/api\/timeline/, ''), changeOrigin: true },
      '/api/playbooks': { target: 'http://localhost:3014', rewrite: (p) => p.replace(/^\/api\/playbooks/, ''), changeOrigin: true },
      '/api/a2ui': { target: 'http://localhost:3015', rewrite: (p) => p.replace(/^\/api\/a2ui/, ''), changeOrigin: true },
      '/ws/a2ui': { target: 'ws://localhost:3015', ws: true, rewrite: (p) => p.replace(/^\/ws\/a2ui/, '/ws'), changeOrigin: true },
      '/api/soc': { target: 'http://localhost:3016', rewrite: (p) => p.replace(/^\/api\/soc/, ''), changeOrigin: true },
      '/api/notifications': { target: 'http://localhost:3017', rewrite: (p) => p.replace(/^\/api\/notifications/, ''), changeOrigin: true },
      '/api/tickets': { target: 'http://localhost:3018', rewrite: (p) => p.replace(/^\/api\/tickets/, ''), changeOrigin: true },
      '/api/a2a': { target: 'http://localhost:3019', rewrite: (p) => p.replace(/^\/api\/a2a/, ''), changeOrigin: true },
      '/ws/a2a': { target: 'ws://localhost:3019', ws: true, rewrite: (p) => p.replace(/^\/ws\/a2a/, '/ws'), changeOrigin: true },
      '/api/orchestrator': { target: 'http://localhost:3000', rewrite: (p) => p.replace(/^\/api\/orchestrator/, ''), changeOrigin: true },
    },
  },
});
