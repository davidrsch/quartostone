import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPort = parseInt(process.env['QUARTOSTONE_PORT'] ?? '4242', 10);

if (!process.env['QUARTOSTONE_PORT']) {
  console.warn(
    '[vite] QUARTOSTONE_PORT not set — dev proxy defaulting to 4242. ' +
    'Set it to match the `port:` in _quartostone.yml.',
  );
}

export default defineConfig({
  root: resolve(__dirname, 'src/client'),
  base: '/editor/',
  build: {
    outDir: resolve(__dirname, 'dist/client'),
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://127.0.0.1:${serverPort}`, changeOrigin: false },
      '/ws': { target: `ws://127.0.0.1:${serverPort}`, ws: true },
      // Proxy the standalone visual editor if requested through the main dev server
      '/visual-editor': {
        target: `http://127.0.0.1:${serverPort}`,
        changeOrigin: false
      }
    },
  },
});
