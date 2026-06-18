const path = require('path');

const root = path.resolve(__dirname, '../..');

module.exports = {
  entry: './src/main.ts',
  target: 'node',
  mode: 'none',
  output: {
    path: path.join(__dirname, '../../dist/apps/api'),
    filename: 'main.js',
    clean: true,
    ...(process.env['NODE_ENV'] !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  resolve: {
    extensions: ['.ts', '.js'],
    // Source libs (e.g. @libs/chain) use .js ESM-style relative imports; map them to .ts.
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
    alias: {
      '@libs/domain': path.join(root, 'libs/domain/src/index.ts'),
      '@libs/db': path.join(root, 'libs/db/src/index.ts'),
      '@libs/chain': path.join(root, 'libs/chain/src/index.ts'),
      '@libs/ai': path.join(root, 'libs/ai/src/index.ts'),
      '@libs/utils': path.join(root, 'libs/utils/src/index.ts'),
      '@libs/auth': path.join(root, 'libs/auth/src/index.ts'),
      '@libs/observability': path.join(root, 'libs/observability/src/index.ts'),
      '@nest/actors': path.join(root, 'nest/actors/src/index.ts'),
      '@nest/analytics': path.join(root, 'nest/analytics/src/index.ts'),
      '@nest/auth': path.join(root, 'nest/auth/src/index.ts'),
      '@nest/db': path.join(root, 'nest/db/src/index.ts'),
      '@nest/daos': path.join(root, 'nest/daos/src/index.ts'),
      '@nest/delegations': path.join(root, 'nest/delegations/src/index.ts'),
      '@nest/logging': path.join(root, 'nest/logging/src/index.ts'),
      '@nest/observability': path.join(root, 'nest/observability/src/index.ts'),
      '@nest/proposals': path.join(root, 'nest/proposals/src/index.ts'),
      '@nest/votes': path.join(root, 'nest/votes/src/index.ts'),
      // Source plugins (incl. API contributions) reach apps/api via @nest/sources (D1).
      '@nest/chain': path.join(root, 'nest/chain/src/index.ts'),
      '@nest/aave': path.join(root, 'nest/sources/aave/src/index.ts'),
      '@nest/compound': path.join(root, 'nest/sources/compound/src/index.ts'),
      '@nest/sources': path.join(root, 'nest/sources/index.ts'),
      '@sources/core': path.join(root, 'libs/sources/core/src/index.ts'),
      '@sources/aave': path.join(root, 'libs/sources/aave/src/index.ts'),
      '@sources/compound': path.join(root, 'libs/sources/compound/src/index.ts'),
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: 'ts-loader',
        options: { configFile: path.join(__dirname, 'tsconfig.app.json') },
        exclude: /node_modules/,
      },
    ],
  },
  externals: [
    ({ request }, callback) => {
      // Bundle workspace aliases (@libs/*, @sources/*, @nest/*); externalize real
      // node_modules. @sources/* is bundled because SourcesModule pulls the source
      // barrels in (D1) — they resolve only via the aliases above, not node_modules.
      if (
        request &&
        !request.startsWith('.') &&
        !path.isAbsolute(request) &&
        !request.startsWith('@libs/') &&
        !request.startsWith('@sources/') &&
        !request.startsWith('@nest/')
      ) {
        return callback(null, `commonjs ${request}`);
      }
      callback();
    },
  ],
  devtool: 'source-map',
};
