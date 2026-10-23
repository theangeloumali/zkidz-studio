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

module.exports = { zksHome, dataDir, ffmpegBin };
