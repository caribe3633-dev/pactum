import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

/**
 * Standalone Vite config — extracted from the original Replit monorepo config.
 * Removed: @replit plugins (runtime-error-modal, cartographer, dev-banner),
 * the `@assets` alias pointing outside the project, and pnpm workspace fs.allow
 * rules. Kept: dist/public outDir and PORT/BASE_PATH env overrides so existing
 * deploy scripts keep working.
 */
const port = Number(process.env.PORT ?? 4173);
const basePath = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
    // dedupe core React packages to avoid duplicate React instances
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        /**
         * تقسيم المكتبات لملفات منفصلة — تحسين تحميل فقط:
         * نفس الكود، نفس السلوك، بس المتصفح بيخزّن كل جزء مؤقتًا على حدة.
         */
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@radix-ui')) return 'vendor-radix';
          if (
            /node_modules[\\/](recharts|d3-[a-z-]+|victory-vendor|react-smooth|recharts-scale)[\\/]/.test(id)
          )
            return 'vendor-charts';
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id))
            return 'vendor-react';
          return undefined;
        },
      },
    },
  },
  server: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
