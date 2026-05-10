const path = require('path');

const root = path.resolve(__dirname, '../..');

module.exports = {
  entry: './src/main.ts',
  target: 'node',
  mode: 'none',
  output: {
    path: path.join(__dirname, '../../dist/apps/ai-worker'),
    filename: 'main.js',
    clean: true,
    ...(process.env['NODE_ENV'] !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@libs/domain': path.join(root, 'libs/domain/src/index.ts'),
      '@libs/db': path.join(root, 'libs/db/src/index.ts'),
      '@libs/chain': path.join(root, 'libs/chain/src/index.ts'),
      '@libs/ai': path.join(root, 'libs/ai/src/index.ts'),
      '@libs/utils': path.join(root, 'libs/utils/src/index.ts'),
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
      if (
        request &&
        !request.startsWith('.') &&
        !path.isAbsolute(request) &&
        !request.startsWith('@libs/')
      ) {
        return callback(null, `commonjs ${request}`);
      }
      callback();
    },
  ],
  devtool: 'source-map',
};
