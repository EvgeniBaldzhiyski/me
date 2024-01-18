# Configuration
- the configuration is based on a powerful NPM lib "config" (https://www.npmjs.com/package/config)
- there has 3 prepared environment
  -- dev `npm run build:dev` (aimed for development, source maps and watch are enabled)
  -- stage `npm run build:stage` (aimed for pred-production tests, source maps are enabled)
  -- prod `npm run build:prod` (final production build, no source maps and code compression is enabled)
  -- 
## Configuration priority
- the config files priority is how it is follow
  -- default.yml
  -- <env>.yml
  -- local.yml
## How to add new environment build
- prepare new file in `webpack/webpack.<env>.js` and the follow content
```
  module.exports = () => {
    return {
      ...common('<env>'),
    };
  };
  ```
- provide new script in package.json
  ```
  "build:<env>": "webpack --config webpack/webpack.<env>.js",
  ```
- add new file (it is not required) `config/<env>.yml`
## How to add new country support
 - open `config/default.yml` and add new injection config
  ```
  <COUNTRY NAME>:
    url: <BASE COUNTRY URL PATH>/*
  ```
 - open `src/utils/comm.map.ts` and add the country's name to the enum `Targets` and hashmap `TargetsMap`
 - create new folder `src/injections/<COUNTRY NAME>/` and file `index.js` included in it
  
## How the project is structured

`root`
  `config` (configuration yml files)
  `public` (static resources)
  `dist` (build output container)
  `webpack` (build configurations and scripts)
  `src`
    `injections` (container for scripts that will be injected in the target sites)
      `<COUNTRY NAME>` (entry point container for a specific country)
        `index.ts` (required file. an entrypoint for site injection)
    `pages` (controllers for an extension pages)
    `utils` (system files)
      `api.client.ts` (web request client - based on fetch [https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API])
      `api.facade.ts` (api client facade)
      `comm.facade.ts` (an facade for communication between extension components and injection scripts)
      `comm.map.ts` (country maps and some system interfaces)
      `config.ts` (npm:config wrapper)
      `interfaces.ts` (backend data interfaces)
      `storage.ts` (runtime storage for dynamic data - api fetched data, sent data from injection scripts, ...)
    `background.ts` (script that is kept online for whole time browser is opened)

## File ext. tech
- typescript - dev files
- javascript - build scripts
- yaml - configuration files

## build output structure
- the folder `public` content is copied in `dist`
- whole ts and js files are built in `dist/js`
- entry points (`index.ts`) in `src/injections` are renamed to `dist/js/<ENTRY POINT FOLDER NAME>.injection.js`
- `manifest.json#content_scripts` and `manifest.json#host_permissions` are extended depend on `targets` section in configuration file. 
- file structure
  `images` - copy of `public/images`
  `js` - script's output 
  `libs` - copy of `public/libs`
  `pages` - copy of `public/pages`
  `styles` - copy of `public/styles`

## how to use in browser
- if you are in dev mode `npm run build:dev` instead `npm run build:stage`
- open browser and navigate to `chrome://extensions/`
- be sure `Developer mode` is enabled
- press `Load unpacked` button and navigate to `dist` folder in your local file system
- press `Select`
- open in new tab any target site
- click `extensions/WorkIsRound` button and start working like follow the instructions

## publish version
- be sure you local.yml is removed or temporary renamed
- run command `npm run build:publish -- --env version=<**major version**.**release version**.**build version**>`
- open `https://chrome.google.com/webstore/devconsole/90ed4b63-f5fd-4601-abc4-bc3a9fcee8f3`
- pres button `+ New Item`
  - all items required to prepare new package version can be found in `publish/`

- ## Development, Releases and Patches
  - Static branches
    - **master** : intended for production. There has always stable version currently working on production
    - **test** : intended for candidate release testing phase. During testing phase the patches are applied here.
    - **develop** : intended for regular development. The version here is not stable and in any moment may have problem with build or something other.
  - Development Workflow
    - standard development
      - checkout new branch from **develop**
      - add and commit feature changes, in the end push all
      - make MR ( **Merge Request** ) with target **develop** and ask for validation (review, thumbs)
      - after MR validation merge it
    - test patch
      - checkout new branch from **test** `git checkout -b "<FREE BRANCH NAME MAYBE DESCRIBE ABOUT THE WORK IS DONE ON IT>"`
      - add and commit patch changes, in the end push all `git add .`, `git commit -m "..."`, `git push`
      - make MR with target **test** and ask for validation
      - after MR validation merge it
      - if there has conflicts with **develop** CI will make conflict branch and will open MR with target **develop**
      - checkout locally the conflict branch `git checkout conflict-auto-merge-00000000`, merge **develop** on it `git merge develop`, resolve the conflicts, complete `git merge --continue` and push changes `git push`
      - the conflict MR with disappear if the conflicts are resolver properly 
    - release flow
      - checkout a new branch `git checkout -b `[candidate-]release-v.0.0.0`
      - create tag from `[candidate-]release-v.0.0.0`
      - make MR from `[candidate-]release-v.0.0.0` with target **test** or **master**
      - merge MR (there doesn't need any validations)
