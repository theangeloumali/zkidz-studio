// Created by The Angelo Umali.
// Live render progress from node (hf/render.js): writes its edit's record in progress.py's format and has progress.py
// rebuild the status line, at most every REFRESH_MS and at once when a stage changes state.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { dataDir } = require("./home");

const PROGRESS = dataDir("progress");
const ENGINE = path.join(__dirname, "..");
const WORK = process.env.ZKS_WORK || process.cwd();
const THROTTLE_MS = 2000;
const HEARTBEAT_MS = 30000; // a quiet running stage still writes this often, well inside progress.py's LIVE
const REFRESH_MS = 5000;
const now = () => Date.now() / 1000;

// progress.py keys a work dir by os.path.normcase(abspath): backslashes and lower case on Windows.
const workKey = () => (process.platform === "win32" ? path.resolve(WORK).toLowerCase() : path.resolve(WORK));
const recordPath = (video) => path.join(PROGRESS, `${crypto.createHash("sha1").update(workKey()).digest("hex").slice(0, 8)}-${video}.json`);

// Writes then renames; a reader holding the file (Windows) can refuse the rename, so retry briefly, then let the next write win.
function writeAtomic(file, text) {
  fs.mkdirSync(PROGRESS, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (error) {
      if (error.code !== "EPERM" && error.code !== "EBUSY") throw error;
    }
  }
  fs.rmSync(tmp, { force: true });
}

// progress.py's refresh leaves each running record's etaS in eta/<record>; it counts only for the run it was computed for.
function refreshedEta(file, record) {
  try {
    const eta = JSON.parse(fs.readFileSync(path.join(PROGRESS, "eta", path.basename(file)), "utf8"));
    return record.state === "running" && eta.stage === record.stage && eta.started === record.started ? eta.etaS : undefined;
  } catch {
    return undefined;
  }
}

let refreshed = 0;
function refresh(force) {
  if (!force && Date.now() - refreshed < REFRESH_MS) return;
  refreshed = Date.now();
  const child = spawn("uv", ["run", "--project", ENGINE, "python", "-m", "zks_engine.progress", "refresh"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", () => {}); // no uv on PATH: the line just goes stale
  child.unref();
}

function job(video, stage) {
  const file = recordPath(video);
  let before = {};
  try {
    before = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // first stage of this edit
  }
  const record = { ...before, video, stage, state: "running", done: 0, total: null, unit: "frames", started: now(), pid: process.pid, work: WORK };
  let written = 0;
  const save = (force) => {
    const etaS = refreshedEta(file, record);
    if (etaS === undefined) delete record.etaS;
    else record.etaS = etaS;
    record.updated = written = now();
    writeAtomic(file, JSON.stringify(record));
    refresh(force);
  };
  save(true);
  const heartbeat = setInterval(() => save(true), HEARTBEAT_MS);
  heartbeat.unref();
  return {
    // slots.js takeSlot's onWait: another session holds the slot this stage needs.
    wait() {
      record.state = "waiting";
      save(true);
    },
    begin(total, frames) {
      Object.assign(record, { state: "running", started: now(), total, frames: frames ?? record.frames ?? null });
      save(true);
    },
    update(done) {
      record.done = done;
      if (now() - written >= THROTTLE_MS / 1000) save(false);
    },
    finish(state) {
      clearInterval(heartbeat);
      record.state = state;
      if (state === "done") {
        record.done = record.total || 0;
        const entry = { stage, units: record.total || 0, seconds: now() - record.started };
        fs.appendFileSync(path.join(PROGRESS, "history.jsonl"), `${JSON.stringify(entry)}\n`);
      }
      save(true);
    },
  };
}

// Runs `work(stage)` as one reported stage: done when it resolves, failed (and rethrown) when it throws.
async function track(video, stageName, work) {
  const stage = job(video, stageName);
  try {
    const result = await work(stage);
    stage.finish("done");
    return result;
  } catch (error) {
    stage.finish("failed");
    throw error;
  }
}

module.exports = { recordPath, track };
