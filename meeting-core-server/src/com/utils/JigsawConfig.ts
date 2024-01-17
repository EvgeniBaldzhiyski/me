import { MongoClientOptions } from 'mongodb';
import { URL } from 'url';

interface serverConfigInterface {
  socketServerPort: number;
  socketServerName: string;
  socketServerPublicDir: string;
  apiServerProtocol: string;
  apiServerHost: string;
  apiServerEndpoint: string;
  apiServerPort: number;
  appUrl: string;
  assetsUrl: string;

  logLevel: string;
  logFormat: 'plain' | 'json';

  allowedOrigins: string;
  environment: string;
  disableBringBackPDF: boolean;
  autopromoteLead: boolean;
  enableEventLog: boolean;
  apiServerToken: string;
  enableKafkaLog: boolean;

  apis: []
    messages: {
      accessToken: string
      protocol: string
      hostname: string
      port: string
      pathname: string
    }

  socketServerConfig: {
    roomKeepAlive: number,
    userKeepAlive: number,
    userDisconnectDelay: number,
    userIdleDelay: number,
    waitPresenterTimeout: number,
    keepAliveInterval: number,
    keepAliveDetector: boolean,
    useJwtAuth: boolean,
  };

  socketServerPortAuthorization: {
    activate: boolean;
    audience: string,
    version: number,
    publicKey: string
    wellKnownConfig: string,
    ghostUserClient: {
      clientId: string,
      clientSecret: string,
      scope: string,
      audience: string,
    }
  };

  mixer: {
    startTimeout: number,
  };

  sut: {
    enabled: boolean,
  };

  adminConsole: {
    allowedIPs: Array<string>,
    credentials: any // hashmap in format {<usr1>:<pass>, <usr2>:<pass>}
  };

  mongoDB: Pick<URL, 'username' | 'password' | 'host' | 'port'> & {
    db: {
      default: string
    },
    options?: MongoClientOptions,
    exitIfConnectionFails?: boolean,
  };

  webrtcTurn: {
    tokensTTL: number,
    refreshBeforeTTL: number, // shows how many seconds before TTL we should refresh the tokens
    authUsr: string,
    authPass: string
  };

  rabbitmq: {
    username: string,
    password: string,
    hostname: string,
    port: number,
  };

  pdfTaskQueue: {
    exchangeName: string,
    queueName: string,
    routingKey: string
  };

  oldBorManager: boolean;

  boxSystem: {
    transcribe: {
      exchangeName: string;
      queueName: string;
      routingKey: string;
      maxRetryAttempts: number;
      initialRetryInterval: number;
    },
    ssr: {
      exchangeName: string;
      queueName: string;
      routingKey: string;
      maxRetryAttempts: number;
      initialRetryInterval: number;
    },
  };

  audioMixerWorkerConfig: {
    exchangeName: string;
    queueName: string;
    routingKey: string;
  };

  pwrWorkerConfig: {
    exchangeName: string;
    queueName: string;
    routingKey: string;
  };

  axios: {
    noteMaxContentLength: number
    noteMaxBodyLength: number
  };

  kafka: {
    topicsPrefix: string;
  };

  // methods
  get(v: string): any;
  has(v: string): boolean;
}

import config from 'config';

export default class serverConfig {
  /**
   * @deprecated Prefer using `config` directly e.g. `config.get('appUrl')` just to have it consistent with other projects
   */
  static get CONFIG(): serverConfigInterface { return config as any as serverConfigInterface; }
}
