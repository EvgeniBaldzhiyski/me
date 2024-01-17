FROM node:14-alpine as base
RUN apk update

FROM base AS runtime-base
# TODO: Check these dependencies and cleanup or split `shared-lib` to own stage
RUN apk add --update --no-cache cairo-dev jpeg-dev pango-dev giflib-dev unifont librsvg-dev \
  # libs needef for pdf generation
  imagemagick ghostscript poppler-utils \
  ttf-opensans ttf-linux-libertine ttf-liberation

RUN mkdir -p /usr/share/fonts/math
COPY ./src/com/apps/pdf-app/resources/fonts/math/* /usr/share/fonts/math/

FROM runtime-base AS buildtime-base
# TODO: Check these dependencies and cleanup or split `shared-lib` to own stage
RUN apk add --update --no-cache --virtual .build-deps alpine-sdk python3 gcc g++ make

FROM buildtime-base AS runtime-packages
WORKDIR /src/app
USER 0
RUN chown -R 1000:1000 .
USER 1000
COPY --chown=1000:1000 .npmrc .npmrc
COPY --chown=1000:1000 ./package.json ./package-lock.json ./
RUN npm ci --unsafe-perm --production

FROM runtime-packages AS buildtime-packages
USER 1000
RUN NODE_ENV=development npm install --unsafe-perm # NOTE: We avoid `npm ci` to not rebuild some stupid binary packages

FROM buildtime-packages AS build
USER 1000
WORKDIR /src/app
ARG NODE_ENV="production"
COPY --chown=1000:1000 ./ ./
RUN npm run build

FROM runtime-base as final
USER root
## CI uses these files to keep the commit hash from the image metadata from the ENV VCS_REF
ARG VCS_REF="HEAD"
ENV VCS_REF=$VCS_REF
RUN \
  mkdir -p /.version \
  && echo "$VCS_REF" > /.version/vcs-ref
WORKDIR /srv/app

ENV NODE_ENV=production
ENV NODE_CONFIG_ENV=development
COPY --chown=0:0 --from=build /src/app/dist ./
COPY --chown=0:0 --from=runtime-packages /src/app/node_modules ./node_modules
# TODO: Move this to its own `pdf-box`, once we create it
COPY --chown=0:0 ./src/com/apps/pdf-app/config/ ./meeting-core-server/com/apps/pdf-app/config

RUN \
  # TODO: Get rid of `logs` from the app container moving them to stdout / stderr
  mkdir -m 0777 -p /srv/app/logs \
  && chown 1000 /srv/app/logs \
  # TODO: Get rid of `temp` from the app container moving it to proper storage CEPH (http://docs.ceph.com/docs/master/start/kube-helm/) or Rook (https://rook.io/)
  && mkdir -m 0777 /srv/app/temp \
  && chown 1000 /srv/app/temp
VOLUME /srv/app/logs /srv/app/temp

EXPOSE 5050
# Insights
EXPOSE 5051

USER 1000
CMD ["node", "meeting-core-server/main.js"]
