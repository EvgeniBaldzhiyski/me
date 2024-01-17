import { ErrorCodes } from '@container/models';
import config from 'config';
import AppInstance from './AppInstance';
import { ApplicationInterface, ApplicationLifeCycleState } from './Application';
import Server, { ApiParserError } from './Server';

export function parseUrl(url: string): {
  appAlias: string,
  instAlias: string,
  endpointName: string,
  params: Record<string, any>
} {
  const parseUrl = new URL(`http://domain${url}`);

  const ids = parseUrl.pathname.split('/');

  ids.splice(0, 1);
  let appAlias = ids.splice(0, 1)[0] || '';
  let instAlias = ids.splice(0, 1)[0] || '';
  const endpointName = ids.splice(0, 1)[0] || '';

  const params: Record<string, any> = {};
  parseUrl.searchParams.forEach((value, key) => {
    if (key === 'namespace') {
      [appAlias, instAlias] = value.split('.');
      return;
    }
    if (key === 'transport') {
      return;
    }

    params[key] = value;
  });

  ids.forEach((value, key) => {
    if(value) {
      params[key] = value;
    }
  });

  // TODO: Refactor the `grants` - consider if really needed
  // temporary
  if (!params.grants) {
    params.grants = [appAlias];
  } else {
    try {
      params.grants = JSON.parse(params.grants);
    } catch (err) {
      params.grants = [appAlias];
    }
  }

  return { appAlias, instAlias, endpointName, params };
}

export async function getValidInstance(
  server: Server,
  appAlias: string,
  instAlias: string,
  params: any,
  forceCreate = false
): Promise<AppInstance<ApplicationInterface>> {
  const app = server.getApp(appAlias);
  if (!app) {
    throw new ApiParserError(`App (${appAlias}) is missing!`, ErrorCodes.FORBIDDEN);
  }

  if (params.grants.indexOf(appAlias) === -1) {
    // @todo maybe here have to provide a specific code
    throw new ApiParserError('Bad Application grants', ErrorCodes.FORBIDDEN);
  }

  if (app.limited && config.get('serviceRegistry.enabled') && !server.hasAllowedInstance(server.getAppInstanceId(appAlias, instAlias))) {
    throw new ApiParserError(`Instance (${appAlias}.${instAlias}) is denied for this server`, ErrorCodes.SERVER_RESTART, true);
  }

  let instance = server.getAppInstanceByName(appAlias, instAlias);

  if (forceCreate) {
    instance = await server.ensureInstance(appAlias, instAlias || app.defname);
  }

  if (!instance) {
    if (instAlias === app.defname) {
      try {
        instance = await server.ensureInstance(appAlias, instAlias);
      } catch (err) {
        throw new ApiParserError(`Self boot instance (${appAlias}.${instAlias}) has failed: ${err.message}`, ErrorCodes.BROKEN_APPLICATION);
      }
    } else {
      throw new ApiParserError(`Instance (${appAlias}.${instAlias}) is not started`, ErrorCodes.SESSION_NOT_STARTED);
    }
  }

  if (instance.app.lifeCycleState === ApplicationLifeCycleState.BROKEN) {
    throw new ApiParserError(
      `Instance (${appAlias}.${instAlias}) is broken.`, ErrorCodes.DOT_NET_CRITICAL
    );
  }

  if (!instance.app.isActive()) {
    throw new ApiParserError(
      `Instance (${appAlias}.${instAlias}) has a wrong state(${instance.app.lifeCycleState}).`, ErrorCodes.SESSION_NOT_RUNNING
    );
  }

  // if there has any dependencies check each is still online, if not try to run it again
  // use case is during main application is online the second remains without any connections online, go through idle mode and is closed by the server
  if (app.dependsOn) {
    const dependList = [];
    for (const dependence of app.dependsOn) {
      if (!server.getAppInstanceByName(dependence, instAlias)) {
        dependList.push(server.bootInstance(dependence, instAlias));
      }
    }

    try {
      await Promise.all(dependList);
    } catch (err) {
      instance.app.lifeCycleState = ApplicationLifeCycleState.BROKEN;
      throw err;
    }
  }

  return instance;
}
