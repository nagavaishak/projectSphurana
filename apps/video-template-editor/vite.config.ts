import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5174, host: true },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // Workspace packages are declaration-only (emitDeclarationOnly: true).
      // Point Vite at the source so it can compile + bundle them directly.
      '@borradh-workspace/remotion/components': path.resolve(
        __dirname,
        '../../packages/remotion/src/components/index.ts'
      ),
      '@borradh-workspace/remotion/types': path.resolve(
        __dirname,
        '../../packages/remotion/src/types/index.ts'
      ),
      '@borradh-workspace/remotion': path.resolve(
        __dirname,
        '../../packages/remotion/src/index.ts'
      ),
      '@borradh-workspace/video-templates/music-registry': path.resolve(
        __dirname,
        '../../packages/video-templates/src/music-registry.ts'
      ),
      '@borradh-workspace/video-templates': path.resolve(
        __dirname,
        '../../packages/video-templates/src/index.ts'
      ),
    },
  },
  optimizeDeps: {
    // Pre-bundle big workspace deps so dev startup is fast.
    include: ['@remotion/player', 'remotion', 'zod', 'zustand'],
  },
});
