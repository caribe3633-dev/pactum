import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT ?? '4173';
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    // Do not force preserveSymlinks here — allow Node/Vite to resolve packages
    // using normal node resolution. Previously this caused workspace packages
    // to be resolved to their realpath which made esbuild scan nested workspace
    // node_modules. Removing this avoids scanning the entire monorepo.
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    // dedupe core React packages to avoid duplicate React instances
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  // Pre-bundle common dependencies from this project's node_modules to force
  // resolution from the local project instead of hoisted workspace packages.
  // Keep workspace packages out of pre-bundling to avoid scanning *their* nested
  // node_modules (workspace packages are handled by pnpm and should resolve at runtime).
  optimizeDeps: {
    include: ['react', 'react-dom', 'wouter'],
    // esbuildOptions could be tuned here if needed
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      // keep strict file serving but allow repo-level node_modules and workspace packages
      strict: true,
      allow: [
        path.resolve(import.meta.dirname),
        path.resolve(import.meta.dirname, 'node_modules'),
        // allow reading from repository root where pnpm hoists some dependencies
        path.resolve(import.meta.dirname, '..', '..', 'node_modules'),
        // allow workspace packages in repo root (lib/*, artifacts/*)
        path.resolve(import.meta.dirname, '..', '..'),
      ],
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
