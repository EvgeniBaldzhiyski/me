import apm from 'elastic-apm-node/start';
import { MongoClient } from 'mongodb';
import { URL } from 'url';
import serverConfig from '../utils/serverConfig';
import { processLogger } from '../utils/processLogger';

const mongoDBConfig = serverConfig.CONFIG.mongoDB;

const connectionString = (() => {
  const connectionUrl = new URL('', 'mongodb://u:p@hostname');
  connectionUrl.username = mongoDBConfig.username;
  connectionUrl.password = mongoDBConfig.password;
  connectionUrl.host = mongoDBConfig.host;
  connectionUrl.port = mongoDBConfig.port;
  return connectionUrl.toString();
})();

export const mongoClient = new MongoClient(
  connectionString,
  {
    ...mongoDBConfig.options,
    useUnifiedTopology: true,
    useNewUrlParser: true,
    forceServerObjectId: false // use driver-generated IDs for the last insert ID functionality to work
  }
);

mongoClient.connect()
  .then(() => {
    processLogger.info('MongoDB Connected');
  })
  .catch((e) => {
  apm.captureError(e);
  processLogger.error(e.message);

  if (mongoDBConfig.exitIfConnectionFails) {
    // in case no connection can be established we better exit right away
    apm.flush(() => process.exit(99));
  }
});

export function defaultDb() {
  return mongoClient.db(mongoDBConfig.db.default);
}
