import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri 需要固定端口 + 不清屏，否则 devUrl 会错位
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5183,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    // Windows 上只有 WebView2（Chromium ≥ 110），可以放心用现代语法
    target: 'chrome114',
    minify: 'esbuild',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
