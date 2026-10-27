# Created by The Angelo Umali.
# The studio built from this checkout with the pinned, checksummed tools (plan §10.0). Built locally only, never pushed.
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS base
ENV DO_NOT_TRACK=1 \
    HYPERFRAMES_NO_TELEMETRY=1 \
    UV_PYTHON_INSTALL_DIR=/opt/zks/tools/python

FROM base AS builder
# xz-utils and unzip unpack the ffmpeg .tar.xz and the chrome-headless-shell .zip; the compilers are for native addons that ship no Linux prebuild.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl unzip xz-utils python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app /opt/zks \
  && chown node:node /app /opt/zks
USER node
WORKDIR /app
COPY --chown=node:node . .
# The same single setup command as on a host, with ZKS_HOME pointed at the image's tool store.
RUN ZKS_HOME=/opt/zks UV_CACHE_DIR=/tmp/uv-cache ./setup.sh --no-start \
  && for dir in /opt/zks/tools/pnpm/*/; do PATH="$dir:$PATH"; done \
  && pnpm -F @zks/web build \
  && rm -rf /opt/zks/tools/.downloads /tmp/uv-cache

FROM base
# Shared libraries chrome-headless-shell and whisper-cli (libgomp1) link against; slim images ship none of them.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libgomp1 libnspr4 libnss3 libpango-1.0-0 libxcomposite1 libxdamage1 libxfixes3 \
    libxkbcommon0 libxrandr2 \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /zks-home \
  && chown node:node /zks-home
COPY --from=builder --chown=node:node /opt/zks /opt/zks
COPY --from=builder --chown=node:node /app /app
COPY --chown=node:node --chmod=0755 docker/entrypoint.sh /usr/local/bin/zks-entrypoint
USER node
WORKDIR /app
ENV ZKS_HOME=/zks-home \
    UV_CACHE_DIR=/zks-home/cache/uv
EXPOSE 4317
ENTRYPOINT ["/usr/local/bin/zks-entrypoint"]
