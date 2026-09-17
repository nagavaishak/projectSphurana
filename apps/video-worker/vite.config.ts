import path from 'node:path';
import { defineConfig } from 'vitest/config';

const pkg = (name: string, entry = 'src/index.ts') =>
  path.resolve(__dirname, `../../packages/${name}/${entry}`);

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    exclude: ['node_modules', 'dist'],
    alias: {
      '@borradh-workspace/database/schema': pkg(
        'database',
        'src/schema/index.ts'
      ),
      '@borradh-workspace/database': pkg('database'),
      '@borradh-workspace/remotion': pkg('remotion'),
      '@borradh-workspace/features/videos': pkg(
        'features',
        'src/videos/index.ts'
      ),
      '@borradh-workspace/features/shared': pkg(
        'features',
        'src/shared/index.ts'
      ),
      '@borradh-workspace/observability': pkg('observability'),
      '@borradh-workspace/video-processing/b-roll': pkg(
        'video-processing',
        'src/b-roll/index.ts'
      ),
      '@borradh-workspace/video-processing/captions': pkg(
        'video-processing',
        'src/captions/index.ts'
      ),
      '@borradh-workspace/video-processing/vision': pkg(
        'video-processing',
        'src/vision/index.ts'
      ),
      '@borradh-workspace/testing': pkg('testing'),
    },
  },
});
