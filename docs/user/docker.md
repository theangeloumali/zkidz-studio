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

## Terminal mode in Docker

Build with a pinned Claude Code release and the terminal pane runs it inside the container. Pick a version from the
[Claude Code setup docs](https://code.claude.com/docs/en/setup#install-a-specific-version), then build with the remote
override below (it requires `CLAUDE_CODE_VERSION`) or directly:

```bash
docker build --build-arg CLAUDE_CODE_VERSION=<version> -f docker/Dockerfile -t zkidz-studio:local .
```

With the variable empty the image carries no Claude Code. The version must be exact (`x.y.z`; `latest` and `stable` fail the build). The build verifies the release manifest's GPG signature against Anthropic's published key fingerprint, then the binary's SHA-256 against that manifest. All updates are off through a managed setting (`/etc/claude-code/managed-settings.json`, `DISABLE_UPDATES`), so the version only changes when you rebuild.
Run `/login` once in the pane. The sign-in lives in Claude Code's own `~/.claude`, never in Studio, and usage counts against
your Claude plan.

## Remote mode behind a TLS proxy

For a server you reach over a private network (a tailnet, say), put a TLS proxy such as Caddy in front. TLS ends at the proxy,
which reaches the container over a shared docker network. Remote mode is off unless both origins are set:

```bash
# .env at the repo root (see .env.example)
CLAUDE_CODE_VERSION=<version>
ZKS_PUBLIC_ORIGIN=https://studio.example.com
ZKS_PREVIEW_PUBLIC_ORIGIN=https://studio-preview.example.com
ZKS_PROXY_SECRET=<32 or more random characters>

docker compose --env-file .env -f docker/compose.yml -f docker/compose.remote.yml up -d --build
```

- `ZKS_PROXY_SECRET` is required in remote mode and must be at least 32 characters (`openssl rand -hex 32` works). The server stops without it.
- Each origin is a bare `https://host`, with no path, and the two must differ. One set without the other stops the server.
- The proxy forwards the public app host to port 4317 and the public preview host to the preview port (`ZKS_PORT` + 1,
  4318 by default), both with the original `Host` header.
- The server still binds as before; the compose file keeps the `127.0.0.1:4317` mapping. That mapping reaches the container from
  the docker bridge gateway, not from loopback, so in remote mode a request through it also needs `x-zks-proxy-secret`. Writes still need the exact
  `https://` Origin and the per-launch CSRF token.
- The override joins the external docker network `proxy-apps` (create it first, or attach your proxy to it) and mounts
  `zks-node-home` at `/home/node` so the Claude Code sign-in survives a rebuild.
- Anyone who can reach the public host can use Studio, so keep it on a private network and do not publish it to the internet.

## Who may reach the server in remote mode

Two separate checks guard a remote setup, and neither replaces the other:

- The human login: put `basic_auth` (or your proxy's equivalent) on both public hosts. Studio has no sign-in of its own.
- The proxy proof: other containers on the shared docker network can reach the server directly, so every request must come
  from a loopback address (the container's own healthcheck) or carry `x-zks-proxy-secret` equal to `ZKS_PROXY_SECRET`.
  Anything else gets `403 Forbidden: proxy`, whatever its `Host` header says.

The proxy sets the header, and `header_up` overwrites any copy a client sent (checked against a real Caddy 2: a request carrying a wrong value still got through). A Caddyfile sketch, with placeholders only:

```caddy
studio.example.com, studio-preview.example.com {
	basic_auth {
		<user> <password-hash>
	}
	@app host studio.example.com
	handle @app {
		reverse_proxy zkidz-studio:4317 {
			header_up x-zks-proxy-secret {env.ZKS_PROXY_SECRET}
		}
	}
	handle {
		reverse_proxy zkidz-studio:4318 {
			header_up x-zks-proxy-secret {env.ZKS_PROXY_SECRET}
		}
	}
}
```

Give the proxy the same `ZKS_PROXY_SECRET` in its environment. Rotate it by changing both and restarting both.

## Limits

- Mode T in the container needs the image built with `CLAUDE_CODE_VERSION` (see below); without it use mode A or B.
- "Use files in place" and **Open folder** work on the container's file system, not yours; drag files in instead.
- Do not bind-mount a host `ZKS_HOME` over `/zks-home`; the entrypoint refuses a real `tools` directory there.
