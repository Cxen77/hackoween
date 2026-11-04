import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  // Local model API (python -m server.model_api). Forecasts degrade gracefully when it is not running.
  server: { proxy: { '/api': 'http://127.0.0.1:8765' } },
  preview: { proxy: { '/api': 'http://127.0.0.1:8765' } },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'next/link': path.resolve(__dirname, './src/lib/next-link.tsx'),
      'next/image': path.resolve(__dirname, './src/lib/next-image.tsx'),
    },
  },
});
