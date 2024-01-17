import proxyaddr from 'proxy-addr';
import config from 'config';
import { IncomingMessage } from 'http';


export function trustProxy() {
  const trust = proxyaddr.compile(config.get<string[]>('internalCIDRs'));
  return (req: IncomingMessage & { ip?: string }, _res, next) => {
    req.ip = proxyaddr(req, trust);

    return next();
  };
}
