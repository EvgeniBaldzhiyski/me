FROM public.ecr.aws/f3y2x0c1/jigsaw/nwjs-sdk:0.60.0 AS nwjs-sdk

FROM node:14-buster AS runtime-base

ENV DISPLAY :99
ENV DISPLAY_WIDTH 640
ENV DISPLAY_HEIGHT 480
ENV DISPLAY_BITS 8

RUN apt-get update -qq && \
  apt-get install \
    libnss3 libasound2 libgtk-3-0 libgbm1 \
    xvfb ffmpeg sudo -y --no-install-recommends && \
  apt-get clean autoclean && \
  apt-get autoremove --yes && \
  rm -rf /var/lib/{apt,dpkg,cache,log}/

RUN echo '%node ALL=NOPASSWD: /usr/bin/xinit*' > /etc/sudoers.d/user-node-allow-run-xinit-as-root
RUN echo '%node ALL=NOPASSWD: /bin/kill*' >> /etc/sudoers.d/user-node-allow-run-xinit-as-root

ENV NWJS_INSTALL_DIR /opt/nwjs
ENV PATH "${PATH}:${NWJS_INSTALL_DIR}"
# Consider not copying unused locales, but it is a bit tricky - watch out!
COPY --chown=0:0 --from=nwjs-sdk $NWJS_INSTALL_DIR $NWJS_INSTALL_DIR

COPY ./fonts /usr/share/fonts/custom
RUN fc-cache -f

# Fix this with: JIG-11269
# RUN echo "pcm.!default { type plug slave.pcm \"null\" }" > /etc/asound.conf

FROM runtime-base AS runtime-packages
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

FROM buildtime-packages AS development
USER root
RUN apt-get install socat -y --no-install-recommends

FROM buildtime-packages AS build
USER 1000
WORKDIR /src/app
ARG NODE_ENV="production"
COPY --chown=1000:1000 ./ ./
RUN npm run build

FROM runtime-base as final
USER root
LABEL maintainer="jigsawinteractive.net"
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
COPY --chown=0:0 --from=build /src/app/node_modules ./node_modules

CMD ["sh", "/srv/app/bootstrap.sh"]
