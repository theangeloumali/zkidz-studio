<!-- Created by The Angelo Umali. -->

# Spike 6: devEngines `onFail: "download"` in a fresh container

**Status: PASS.** In a fresh `node:24` container pnpm downloaded the pinned Node runtime, locked it with checksums and ran
scripts on it. The bootstrapped pnpm then switched itself to the pinned pnpm version.

## Goal

Plan §7.5: the repo pins Node and pnpm in `devEngines` with `onFail: "download"`, so a contributor does not need a
matching Node installed. Does that work on a clean machine without Corepack?

## Commands

```bash
docker run --rm -v "$PWD/docs/spikes/06-devengines-download:/spike:ro" node:24 bash /spike/in-container.sh
```

The spike directory is the only mount, and it is read-only. `in-container.sh` copies `fixture/` to `/work`, installs
pnpm 11.24.0 with npm (no Corepack), runs `pnpm install`, and prints which Node the scripts and a bare `node` use.
`fixture/package.json` pins `devEngines.runtime` node 24.22.0 and `devEngines.packageManager` pnpm 12.15.0, both with
`onFail: "download"`. Full output: `results/run.log`.

## Output excerpts

```text
node:24 digest sha256:6449e19d8184d84062525b6a7524def03146c2cb04a7f08b076680d0e8e4240a
container node: v24.22.1
bootstrap pnpm: 12.15.0                      # npm installed 11.24.0; devEngines.packageManager took over
Downloading node@runtime:24.22.0: 57.20 MB/58.25 MB
devDependencies:
+ node 24.22.0
Done in 5.6s using pnpm v12.15.0
pnpm-lock.yaml:   node@runtime:24.22.0: resolution: type: variations, variants: [archive: tarball ...]
                  packageManagerDependencies: pnpm 12.15.0 (+ @pnpm/exe.* per platform, sha512 each)
script node v24.22.0 /work/node_modules/.pnpm/node@runtime+24.22.0/node_modules/node/bin/node
bare node in project: v24.22.1
```

The whole run, with an image already pulled, took about 14 s.

## Decision for the plan

1. Keep `devEngines.runtime` + `devEngines.packageManager` with `onFail: "download"`; no Corepack is needed. The runtime
   and pnpm are written to the lockfile with per-platform integrity hashes.
2. **Only package scripts are pinned.** A bare `node` in the project still ran the container's v24.22.1; pnpm documents
   bare-command shims from v12.0.0-rc.2, but they are not active after a plain `pnpm install` here. Docs and `doctor`
   should tell contributors to run everything through `pnpm run` / `pnpm exec`, and CI should do the same.
