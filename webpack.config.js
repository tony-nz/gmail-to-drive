const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    'service-worker': './src/background/service-worker.js',
    'content-script': './src/content/content-script.js',
    'offscreen': './src/offscreen/offscreen.js',
    'popup': './src/popup/popup.js',
    'options': './src/options/options.js',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
        exclude: /gmail-inject\.css$/,
      },
    ],
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'manifest.json', to: '.' },
        { from: 'src/popup/popup.html', to: '.' },
        { from: 'src/popup/popup.css', to: '.' },
        { from: 'src/options/options.html', to: '.' },
        { from: 'src/options/options.css', to: '.' },
        { from: 'src/offscreen/offscreen.html', to: '.' },
        { from: 'src/styles/gmail-inject.css', to: '.' },
        { from: 'assets', to: 'assets', globOptions: { ignore: ['**/design/**'] } },
      ],
    }),
  ],
  resolve: {
    extensions: ['.js'],
  },
  optimization: {
    minimize: true,
  },
};
