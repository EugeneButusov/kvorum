const path = require('path');

const root = path.resolve(__dirname, '../..');

module.exports = {
  entry: './src/main.ts',
  target: 'node',
  mode: 'none',
  output: {
    path: path.join(__dirname, '../../dist/apps/indexer'),
    filename: 'main.js',
    clean: true,
    ...(process.env['NODE_ENV'] !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@kvorum/domain': path.join(root, 'libs/domain/src/index.ts'),
      '@kvorum/db': path.join(root, 'libs/db/src/index.ts'),
      '@kvorum/chain': path.join(root, 'libs/chain/src/index.ts'),
      '@kvorum/ai': path.join(root, 'libs/ai/src/index.ts'),
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
        !request.startsWith('@kvorum/')
      ) {
        return callback(null, `commonjs ${request}`);
      }
      callback();
    },
  ],
  devtool: 'source-map',
};
