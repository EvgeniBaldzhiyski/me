const common = require('./webpack.common.js');

module.exports = () => {
  return common({
    node_env: 'stage',

    webpack: {
      devtool: 'inline-source-map',
      mode: 'development',
    }
  });
}
