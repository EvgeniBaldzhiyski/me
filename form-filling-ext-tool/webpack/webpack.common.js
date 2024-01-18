const webpack = require("webpack");
const path = require("path");
const fs = require('fs');
const archiver = require('archiver');
const CopyPlugin = require("copy-webpack-plugin");
const moment = require("moment");

const SRC = '../src/';
const OUTPUT = '../dist/';
const PUBLISH = '../publish/';

class BuildZipper {
  options = {};

  constructor(options) {
    this.options = options || {};
  }

  apply(compiler) {
    compiler.hooks.afterEmit.tap(this.constructor.name, () => {
      if (!fs.existsSync(this.options.output)) {
        fs.mkdirSync(this.options.output);
      }

      const archive = archiver('zip', { zlib: { level: 9 }});
      const stream = fs.createWriteStream(`${this.options.output}/${this.options.file}`);

      archive
        .directory(this.options.source, false)
        .on('error', err => console.error('ERROR:', `Zip failed (${err})`))
        .pipe(stream)
      ;

      stream.on('close', () => console.log('Zip is builded'));
      archive.finalize();
    });
  }
}

module.exports = (options) => {
  console.log("options", options);

  const lineParams = {};
  for(const [index, arg] of process.argv.entries()) {
    if (arg === '--env') {
      const list = process.argv[index + 1].split(/[=,]/g);
      for (let i = 0; i < list.length; i = i + 2) {
        lineParams[list[i]] = list[i + 1] || list[i];
      }
      break;
    }
  } 

  const now = Date.now();

  process.env.NODE_ENV = options.node_env;

  const config = require("config");

  config.version = lineParams.version || '0.0.0';

  const entry = {
    background: path.join(__dirname, `${SRC}background.ts`),

    login: path.join(__dirname, `${SRC}pages/login.ts`),
    posting: path.join(__dirname, `${SRC}pages/posting.ts`),
    postings: path.join(__dirname, `${SRC}pages/postings.ts`),
  };

  for (const [name] of Object.entries(config.targets)) {
    entry[`${name}.injection`] = path.join(
      __dirname,
      `${SRC}injections/${name}/index.ts`
    );
  }

  return {
    ...options.webpack,
    entry,
    output: {
      path: path.join(__dirname, `${OUTPUT}js`),
      filename: "[name].js",
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: "ts-loader",
          exclude: /node_modules/,
        },
      ],
    },
    resolve: {
      extensions: [".ts", ".tsx", ".js"],
    },
    plugins: [
      new webpack.DefinePlugin({
        CONFIG: JSON.stringify(config)
      }),
      new CopyPlugin({
        patterns: [
          { from: ".", to: "../", context: "public" },
          {
            from: "./manifest.json",
            to: "../",
            transform(content) {
              const manifest = JSON.parse(content.toString());

              for (const [name, {url}] of Object.entries(config.targets)) {
                manifest.content_scripts.push({
                  matches: [url],
                  js: [`js/${name}.injection.js`],
                });
                manifest.host_permissions.push(url);
              }

              manifest.version = lineParams.version || '0.0.0';

              return JSON.stringify(manifest, null, 4);
            },
            context: "public"
          },
        ],
      }),
      (options.zipped ? new BuildZipper({
        source: path.join(__dirname, OUTPUT),
        output: path.join(__dirname, PUBLISH),
        file: `workisround${moment-(now).format('YYYY-MM-DD_HH-MM-SS')}.zip`
      }) : () => {})
    ],
  };
};
