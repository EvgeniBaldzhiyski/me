## configurations

The the project is using https://www.npmjs.com/package/config for configuration files.

The configurations are saved in the `config` folder. You can use the configuration values in the nodejs project by using the class bellow.

The config values for the socket server are:
- socketServerPort - shows the port on which the socket server listens, by default we use `5050`.
- socketServerName - the name of the socket server instance, default value for dev is `meetingCoreServerDEV`.
- socketServerPublicDir - the place where the static files served from the server are, default value - `./public`.
- apiServerProtocol - the protocol for the api server, default value - `http`.
- apiServerHost - the host for the api server, default value for the `docker-compose` file - `meetingCoreServermock`.
- apiServerPort - the port on which the api server is listening, default value for the mock server - `4400`.
- apiServerEndpoint - the prefix part of the url for the api server, by default the mock server uses `mock`.
- socketServerConfig - some values specific for the socket server ion format `<name>:<value>`.
- adminConsole:
 - allowedIPs - array of IP addresses allowed to access the admin console.
 - credentials - users for the admin console in format `<uname>:<passhash>`.

### Basic usage
***Note:*** for more info you can check https://github.com/lorenwest/node-config

The configuration files are in the `config` folder and follow the `node-config` configuration files conventions - https://github.com/lorenwest/node-config/wiki/Configuration-Files

The main configuration file is `default.json`. If you need to overwrite some configuration value for a specific environment you need a `<environment>.json` file containing only the values that need to override the `default.json` values. The default environment is `development` (you will need `development.json` file). Other environments are `production`, `stage` and `qa`. To switch the environment you need to set the `NODE_ENV` environment variable. Example:

```
export NODE_ENV=production
npm start
```

You can also override some configuration values for your local environment. To do that use a file called `local-<environment>.json`. For development - `local-development.json`. Note that the `config/local-*` files are ignored on commits. There is a default `local-development.json` file, if you want to use it you will need to add the needed hosts in your `hosts` file.

You can also change the location of the `config` folder if needed. Example `export NODE_CONFIG_DIR=my_config`. And even override some config values for one run with:

```
export NODE_CONFIG='{"baseUrl":"localhost:8080"}'
npm start
```

The result configuration object is compiled form the json files in the following order:
- default.json
- <environment>.json
- local.json

Each file is overriding the values from the previous file. All files should be present, but some of them might have an empty object inside: `{}`. You can bring more complicated scheme - see https://github.com/lorenwest/node-config/wiki/Configuration-Files . But note that the more complicated theme will work only for nodejs projects. Some changes in the client code might be needed to support the new scheme too.

Basically the two classes are similar and you can use the `CONFIG` property to get the right configuration values.

