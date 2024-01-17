// For more configuration options
// @see https://www.elastic.co/guide/en/apm/agent/nodejs/current/configuration.html
module.exports = {
  serviceName: 'meeting-core-server',
  environment: 'local',
  // this serverUrl is only available in the internal network and requires VPN
  serverUrl: 'https://apm.dev.domain.com',
  secretToken: 'DtMNh7X5X03N4h7Cy0M84B1a',
  // TODO: We use self-signed certs, make the ES CA available and trusted here
  verifyServerCert: false,
  // Catch each {transactionSampleRate} of the requests, to limit performance penalty
  // @see https://www.elastic.co/guide/en/apm/agent/nodejs/current/performance-tuning.html
  // @see https://itnext.io/distributed-tracing-in-your-kibana-with-nodejs-610c9f07b4b4
  // Note, that this is configurable through the Kibana and can be activated real-time
  // @see https://www.elastic.co/guide/en/apm/agent/nodejs/current/configuration.html#central-config
  transactionSampleRate: 0,
  // TODO: Check if disabling this is really the way to go in case we have
  //       a custom uncaughtException and unhandledRejection handler
  captureExceptions: false,
  logUncaughtExceptions: true,
  captureSpanStackTraces: false,
  // @see https://www.elastic.co/guide/en/apm/agent/nodejs/master/configuration.html#transaction-ignore-urls
  transactionIgnoreUrls: [
    // skip transactions on internal endpoints like `/__wip`, `/__metrics`, etc.
    '/__*'
  ]
}
