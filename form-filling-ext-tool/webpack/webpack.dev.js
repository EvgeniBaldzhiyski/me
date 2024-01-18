const common = require('./webpack.common.js');

module.exports = () => {
  return common({
    node_env: 'dev',
    webpack: {
      devtool: 'inline-source-map',
      mode: 'development',
      watch: true,
    }
  });
}
