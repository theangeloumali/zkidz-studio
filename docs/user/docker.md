<!-- Created by The Angelo Umali. -->

# Running ZKidz Studio in Docker

For people who prefer a container to a host install, or want GPU encoding on a Linux server. Last reviewed 2026-10-24.

You need Docker with Compose v2. The image is built from your checkout and never pulled from or pushed to a registry.

## Start it

```bash
git clone https://github.com/theangeloumali/zkidz-studio && cd zkidz-studio
docker compose -f docker/compose.yml up -d --build
```

Open <http://127.0.0.1:4317>. The first build runs the same `setup.sh` as a host install, so it downloads the pinned tools and
takes a while.

## What compose sets up

- Port: `127.0.0.1:4317:4317`. The server binds every interface inside the container (`ZKS_CONTAINER=1`), so this loopback
  mapping is what keeps it off your network. Do not change it to `4317:4317`.
- Data: a named volume, `zks-home`, mounted at `/zks-home`. It holds the database, projects, renders and the API key you enter in
  the app (an owner-only file). Never put the key in `.env`.
- Tools: the image carries the pinned ffmpeg, Chrome, Python and setup models. A rebuild with a newer `tools.lock.json` updates
  them; models you fetch later stay in the volume.

Check the publishing:

```bash
docker ps --format '{{.Names}} {{.Ports}}'      # expect 127.0.0.1:4317->4317/tcp
```

## NVIDIA GPU

With the NVIDIA Container Toolkit installed, start the GPU service instead of the default one. Both publish port 4317, so run
one at a time:

```bash
docker compose -f docker/compose.yml stop studio
docker compose -f docker/compose.yml --profile nvidia up -d --build studio-nvidia
```

The service asks for the `video` driver capability, which mounts the NVENC and NVDEC libraries. Without it the doctor falls back
to `cpu`.

## Everyday commands

```bash
docker compose -f docker/compose.yml logs -f studio      # follow the server log
docker compose -f docker/compose.yml down                # stop; the zks-home volume keeps your projects
docker compose -f docker/compose.yml up -d --build       # rebuild after git pull
```

`docker compose -f docker/compose.yml down -v` also deletes the `zks-home` volume and every project in it.

## Limits

- Mode T needs Claude Code on the host, so use mode A or B in the container.
- "Use files in place" and **Open folder** work on the container's file system, not yours; drag files in instead.
- Do not bind-mount a host `ZKS_HOME` over `/zks-home`; the entrypoint refuses a real `tools` directory there.
