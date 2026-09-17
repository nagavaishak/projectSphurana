import { Config } from '@remotion/cli/config';

Config.setEntryPoint('./src/remotion-entry.ts');
Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);

// The renderer tree uses ESM-style relative imports with explicit `.js`
// extensions (nodenext convention) while the source is `.ts`/`.tsx`. Webpack 5
// resolves the literal `.js` and otherwise fails to find the on-disk `.ts`
// file when bundling from source. `extensionAlias` maps `.js` → `.ts`/`.tsx`
// so source bundling matches how tsc / node resolve these imports.
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    extensionAlias: {
      ...(config.resolve?.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    },
  },
}));
