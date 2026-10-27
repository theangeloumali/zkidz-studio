// Created by The Angelo Umali.
// Bundles the production server into dist/main.mjs: one file loads in well under a second where
// hundreds of type-stripped modules take 10-60 s on a WSL /mnt/c checkout (plan §9.5).
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = `${SERVER_DIR}/dist/main.mjs`;

/** Native addons and the SDK's platform binary load from node_modules at runtime. PGlite's JS is bundled; its wasm and data stay on disk. */
export const EXTERNAL_PACKAGES = ["node-pty", "@napi-rs/keyring", "@anthropic-ai/claude-agent-sdk"];

/** Imports each external by its real file path: a bare specifier makes node walk pnpm symlinks on every start (~0.4 s each on /mnt/c). */
const preResolveExternals = {
  name: "pre-resolve-externals",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /.*/ }, ({ path, kind }) => {
      if (!EXTERNAL_PACKAGES.includes(path) || kind === "require-resolve") return undefined;
      const target = realpathSync(fileURLToPath(import.meta.resolve(path)));
      return { path: `./${relative(dirname(OUT_FILE), target).split("\\").join("/")}`, external: true };
    });
  },
};

const LOADERS = { ".ts": "ts", ".mts": "ts", ".js": "js", ".mjs": "js" };

/** Points each file's `import.meta.url` back at its source path, so `new URL("../x", import.meta.url)` still finds `x` from the bundle. */
const keepSourceUrls = {
  name: "keep-source-import-meta-url",
  setup(pluginBuild) {
    pluginBuild.onLoad({ filter: /\.[mc]?[jt]s$/ }, async ({ path }) => {
      const loader = LOADERS[extname(path)];
      const source = await readFile(path, "utf8");
      if (loader === undefined || !source.includes("import.meta.url")) return undefined;
      const fromBundle = relative(dirname(OUT_FILE), path).split("\\").join("/");
      return { loader, contents: source.replaceAll("import.meta.url", `new URL(${JSON.stringify(fromBundle)}, import.meta.url).href`) };
    });
  },
};

await build({
  entryPoints: [`${SERVER_DIR}/src/main.ts`],
  outfile: OUT_FILE,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: EXTERNAL_PACKAGES,
  plugins: [preResolveExternals, keepSourceUrls],
  // ws's optional native addons are not installed; failing to find them walks every node_modules up the tree.
  define: { "process.env.WS_NO_BUFFER_UTIL": '"1"', "process.env.WS_NO_UTF_8_VALIDATE": '"1"' },
  // Bundled CommonJS deps call require() for node builtins; ESM has no require of its own.
  banner: { js: 'import { createRequire as __zksCreateRequire } from "node:module"; const require = __zksCreateRequire(import.meta.url);' },
  sourcemap: "linked",
  logLevel: "warning",
});
