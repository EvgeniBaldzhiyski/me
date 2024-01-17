import serverConfig from '../utils/serverConfig';

/**
 * @class
 * @export {ServerConfig}
 */
export default class ServerConfig {
  /**
   * @public {string} name - server name
   */
  public name = 'Unknown';

  /**
   * @public {number} port - server port
   */
  public port = 3000;

  /**
   * @public {number} instShutdownTimer - (in secs) the time span of idle application instance life
   */
  public instShutdownTimer = 120;

  public siteRoot = './public';

  /**
   * @param {object} [conf] - shortcut setup setup without instanciate in first.
   */
  constructor(conf: object = {}) {
    this.setup(conf);
  }

  /**
   * internaly usage. Keeps the constructor clean.
   *
   * @param {object} conf
   */
  protected setup(conf: object) {
    this.name = serverConfig.CONFIG.socketServerName;
    this.port = serverConfig.CONFIG.socketServerPort;
    this.instShutdownTimer = serverConfig.CONFIG.socketServerConfig.roomKeepAlive;
    this.siteRoot = serverConfig.CONFIG.socketServerPublicDir;

    for (const p in conf) {
      try {
        if (typeof this[p] != 'undefined') {
          this[p] = conf[p];
        }
      } catch (err) { }
    }
  }
}
