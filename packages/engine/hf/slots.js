// Created by The Angelo Umali.
// Node twin of slots.py: the same lock files in the same folder, so overlay drawing queues across sessions and worktrees.
const fs = require("fs");
const path = require("path");
const { dataDir } = require("./home");

const LOCKS = dataDir("locks");
const SLOTS = { gpu: 1, overlay: 1, whisper: 1 };
const POLL_MS = 5000;
const STALE_MS = 12 * 3600 * 1000;
const UNREADABLE_GRACE_MS = 60 * 1000;

// process.kill(pid, 0) only probes in Node (unlike Python's os.kill on Windows, which terminates). A Linux zombie still
// answers it, so its state in /proc decides: a dead holder's lock must be reclaimed.
function alive(pid) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return error.code === "EPERM";
  }
  if (process.platform !== "linux") return true;
  try {
    return fs.readFileSync(`/proc/${pid}/stat`, "utf8").split(") ").at(-1)[0] !== "Z";
  } catch {
    return false;
  }
}

function holder(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function isStale(file) {
  const info = holder(file);
  if (!info) {
    try {
      return Date.now() - fs.statSync(file).mtimeMs > UNREADABLE_GRACE_MS;
    } catch {
      return false;
    }
  }
  return !alive(info.pid) || Date.now() - info.since * 1000 > STALE_MS;
}

function tryTake(file, label) {
  try {
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, label, since: Date.now() / 1000 }), { flag: "wx" });
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
}

// Resolves once a `kind` slot is held; it is released when the process exits, even on a crash or process.exit.
async function takeSlot(kind, label, onWait = () => {}) {
  fs.mkdirSync(LOCKS, { recursive: true });
  const files = Array.from({ length: SLOTS[kind] }, (_, index) => path.join(LOCKS, `${kind}-${index}.lock`));
  let announced = false;
  for (;;) {
    for (const file of files) {
      if (tryTake(file, label)) {
        process.on("exit", () => {
          if (holder(file)?.pid === process.pid) fs.rmSync(file, { force: true });
        });
        return;
      }
      if (isStale(file)) fs.rmSync(file, { force: true });
    }
    if (!announced) {
      console.log(`waiting for the ${kind} slot, held by: ${files.map((file) => holder(file)?.label ?? "?").join("; ")}`);
      onWait();
      announced = true;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

module.exports = { takeSlot };
