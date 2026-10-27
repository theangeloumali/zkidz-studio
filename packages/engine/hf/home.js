// Created by The Angelo Umali.
// Node twin of zks_engine/home.py: ZKS_HOME, else the OS data dir; ZKS_<NAME> overrides one data dir.
const os = require("os");
const path = require("path");

const APP_DIR = "zkidz-studio";

function zksHome(platform = process.platform, env = process.env) {
  if (env.ZKS_HOME) return env.ZKS_HOME;
  if (platform === "win32") return path.join(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), APP_DIR);
  if (platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", APP_DIR);
  return path.join(env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), APP_DIR);
}

const dataDir = (name) => process.env[`ZKS_${name.toUpperCase()}`] || path.join(zksHome(), name);

// Twin of ffio.ffmpeg_bin: the pinned ZKS_FFMPEG, PATH only in a dev checkout.
const ffmpegBin = () => process.env.ZKS_FFMPEG || "ffmpeg";

// Twin of ffio.ffprobe_bin: ZKS_FFPROBE, else the ffprobe beside ZKS_FFMPEG (keeping a Windows .exe).
function ffprobeBeside(ffmpeg) {
  const dirEnd = Math.max(ffmpeg.lastIndexOf("/"), ffmpeg.lastIndexOf("\\")) + 1;
  return `${ffmpeg.slice(0, dirEnd)}ffprobe${/\.exe$/i.test(ffmpeg) ? ".exe" : ""}`;
}

// The pinned tools for HyperFrames, which otherwise runs ffmpeg/ffprobe from PATH and Chrome from its own cache.
// Unset only in a dev checkout, where HyperFrames' own lookups stand.
function hyperframesToolsEnv(env = process.env) {
  const tools = {};
  if (env.ZKS_CHROME) tools.PRODUCER_HEADLESS_SHELL_PATH = env.ZKS_CHROME;
  if (env.ZKS_FFMPEG) tools.HYPERFRAMES_FFMPEG_PATH = env.ZKS_FFMPEG;
  if (env.ZKS_FFPROBE || env.ZKS_FFMPEG) tools.HYPERFRAMES_FFPROBE_PATH = env.ZKS_FFPROBE || ffprobeBeside(env.ZKS_FFMPEG);
  return tools;
}

module.exports = { dataDir, ffmpegBin, hyperframesToolsEnv };
