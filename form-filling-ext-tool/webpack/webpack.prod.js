const common = require('./webpack.common.js');

module.exports = () => {
  return common({
    node_env: 'prod',
    webpack: {
      mode: 'production'
    }
  });
}
