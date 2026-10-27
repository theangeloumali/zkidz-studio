#!/bin/sh
# Created by The Angelo Umali.
# Links the volume's tools and setup models to the image's pinned copies, then starts the server.
set -eu
IMAGE_STORE=/opt/zks
mkdir -p "$ZKS_HOME/models"
# The image owns the tools, so a rebuild with a new tools.lock.json repoints the link.
# A real directory is a bind-mounted host ZKS_HOME holding its own downloads: never delete it.
if [ -L "$ZKS_HOME/tools" ] || [ ! -e "$ZKS_HOME/tools" ]; then
  ln -sfn "$IMAGE_STORE/tools" "$ZKS_HOME/tools"
else
  echo "$ZKS_HOME/tools is a real directory; mount the zks-home volume at $ZKS_HOME instead of a host ZKS_HOME" >&2
  exit 1
fi
# Models fetched later stay in the volume; only the setup models come from the image.
for model in "$IMAGE_STORE"/models/*; do
  [ -e "$model" ] || continue
  target="$ZKS_HOME/models/${model##*/}"
  [ -e "$target" ] || ln -sfn "$model" "$target"
done
exec node /app/apps/server/src/main.ts "$@"
