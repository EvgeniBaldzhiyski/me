const common = require('./webpack.common.js');

module.exports = () => {
  return common({
    node_env: 'prod',
    zipped: true,
    webpack: {
      mode: 'production'
    }
  });
}
