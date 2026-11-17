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
# Terminal mode runs Claude Code in the image. Empty (the default) installs nothing and leaves the image as it was.
# Verified install, per https://code.claude.com/docs/en/setup#binary-integrity-and-code-signing: the release manifest's
# GPG signature (pinned key fingerprint) vouches for the binary's SHA-256. install.sh only checks an unsigned manifest.
ARG CLAUDE_CODE_VERSION=
ARG CLAUDE_CODE_RELEASE_FPR=31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# Installed under /opt, not ~node: the remote override mounts a volume over /home/node, which would hide the binary.
RUN if [ -n "$CLAUDE_CODE_VERSION" ]; then \
    [[ "$CLAUDE_CODE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
      || { echo "CLAUDE_CODE_VERSION must be an exact x.y.z version, got: $CLAUDE_CODE_VERSION" >&2; exit 1; }; \
    apt-get update && apt-get install -y --no-install-recommends curl gnupg && rm -rf /var/lib/apt/lists/* \
    && case "$(dpkg --print-architecture)" in amd64) platform=linux-x64 ;; arm64) platform=linux-arm64 ;; *) echo "no Claude Code build for $(dpkg --print-architecture)" >&2; exit 1 ;; esac \
    && release="https://downloads.claude.ai/claude-code-releases/$CLAUDE_CODE_VERSION" \
    && work="$(mktemp -d)" && export GNUPGHOME="$work/gnupg" && install -d -m 0700 "$GNUPGHOME" \
    && curl -fsSL https://downloads.claude.ai/keys/claude-code.asc | gpg --batch --import \
    && curl -fsSL -o "$work/manifest.json" "$release/manifest.json" \
    && curl -fsSL -o "$work/manifest.json.sig" "$release/manifest.json.sig" \
    && gpg --batch --status-fd 1 --verify "$work/manifest.json.sig" "$work/manifest.json" | grep -q "^\[GNUPG:\] VALIDSIG .* $CLAUDE_CODE_RELEASE_FPR\$" \
    && expected="$(node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(m.version!==process.argv[3])process.exit(2);process.stdout.write(m.platforms[process.argv[2]].checksum)' "$work/manifest.json" "$platform" "$CLAUDE_CODE_VERSION")" \
    && install -d /opt/claude-code/bin \
    && curl -fsSL -o /opt/claude-code/bin/claude "$release/$platform/claude" \
    && echo "$expected  /opt/claude-code/bin/claude" | sha256sum -c - \
    && chmod 0755 /opt/claude-code/bin/claude \
    && ln -s /opt/claude-code/bin/claude /usr/local/bin/claude \
    && install -d /etc/claude-code \
    && printf '{"env":{"DISABLE_UPDATES":"1","DISABLE_AUTOUPDATER":"1"}}\n' > /etc/claude-code/managed-settings.json \
    && rm -rf "$work"; \
  fi
COPY --from=builder --chown=node:node /opt/zks /opt/zks
COPY --from=builder --chown=node:node /app /app
COPY --chown=node:node --chmod=0755 docker/entrypoint.sh /usr/local/bin/zks-entrypoint
USER node
WORKDIR /app
ENV ZKS_HOME=/zks-home \
    UV_CACHE_DIR=/zks-home/cache/uv
EXPOSE 4317
ENTRYPOINT ["/usr/local/bin/zks-entrypoint"]
