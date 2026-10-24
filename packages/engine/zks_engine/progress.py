# Created by The Angelo Umali.
# Live render progress, machine-wide: every heavy stage of every session writes its edit's record here, and refresh()
# turns them into the status line's text (progress_eta) and fires each milestone's toast exactly once (notify).
# Usage: python -m zks_engine.progress plan [--runner PID] v17r v17 …   (the runner's queue)  |  editing vN [--file cues/vN.js]  |  refresh  |  status
import contextlib
import json
import os
import sys
import threading
import time

from . import notify
from . import progress_eta
from . import progress_store
from .pipeline import load_edl
from .progress_store import claim, editing_path, read_history, read_record, record_path, work_name, write_atomic, write_record  # noqa: F401
from .slots import alive

THROTTLE = 2.0  # seconds between one job's writes
HEARTBEAT = 30  # seconds between a quiet running stage's writes, well inside LIVE
LIVE = 90  # seconds the line stays valid without a refresh
KEEP = {"done": 120, "failed": 600, "stopped": 600}  # seconds a finished edit stays on the line
ACTIVE = ("running", "waiting", "queued")
EDITING_IDLE = 600  # seconds after its last spec write that an edit stops showing as being edited


class Job:
    def __init__(self, video, stage, total, unit, frames, state="running"):
        before = read_record(record_path(video)) or {}
        self.record = {**before, "video": video, "stage": stage, "state": state, "done": 0, "total": total, "unit": unit,
                       "frames": frames or before.get("frames"), "started": time.time(), "pid": os.getpid(), "work": work_name()}
        self.written = 0.0
        self.lock = threading.Lock()  # the heartbeat thread saves too
        self.stopped = threading.Event()

    def save(self):
        with self.lock:
            now = time.time()
            eta = progress_eta.eta_seconds(self.record, read_history(), now)
            if eta is None:
                self.record.pop("etaS", None)
            else:
                self.record["etaS"] = eta
            self.record["updated"] = self.written = now
            write_record(self.record)
            refresh()

    def beat(self):
        """Saves every HEARTBEAT seconds until the stage ends: a stage that reports nothing for a while (a join, a browser
        starting) must not read as stopped."""
        def run():
            while not self.stopped.wait(HEARTBEAT):
                self.save()

        threading.Thread(target=run, daemon=True).start()

    def wait(self):
        """slots.slot's on_wait: another session holds the slot this stage needs."""
        self.record["state"] = "waiting"
        self.save()

    def begin(self, total=None):
        """The slot is ours: the stage's clock starts now."""
        self.record.update(state="running", started=time.time(), total=self.record["total"] if total is None else total)
        self.save()

    def update(self, done):
        self.record["done"] = done
        if time.time() - self.written >= THROTTLE:
            self.save()

    def finish(self, state):
        self.stopped.set()
        self.record["state"] = state
        if state == "done":
            self.record["done"] = self.record["total"] or 0
            entry = {"stage": self.record["stage"], "units": self.record["total"] or 0, "seconds": time.time() - self.record["started"]}
            with (progress_store.PROGRESS / "history.jsonl").open("a", encoding="utf-8") as history:
                history.write(json.dumps(entry) + "\n")
        self.save()


@contextlib.contextmanager
def job(video, stage, total=None, unit="frames", frames=None):
    """One stage of an edit, reported for the with-block: done on a clean exit, failed on an error or sys.exit(<message>)."""
    current = Job(video, stage, total, unit, frames)
    current.save()
    current.beat()
    try:
        yield current
    except SystemExit as stop:
        current.finish("done" if stop.code in (None, 0) else "failed")
        raise
    except BaseException:
        current.finish("failed")
        raise
    current.finish("done")


def plan_path(now):
    """A new plan file; names sort by creation, and a second plan in the same clock tick takes the next free name."""
    stamp = int(now * 1000)
    while (path := progress_store.PROGRESS / f"plan-{stamp:015d}.json").exists():
        stamp += 1
    return path


def plan(videos, frames_of, runner=None):
    """The runner's queue: each edit shows as queued until its first stage starts, and is dropped if `runner` (its pid;
    this process's parent by default) dies first. An edit planned again leaves the batch it was in."""
    now = time.time()
    names = [record_path(video).name for video in videos]
    for plan_file in progress_store.PROGRESS.glob("plan-*.json"):
        older = read_record(plan_file)
        kept = [name for name in (older or {}).get("records", []) if name not in names]
        if not kept:
            plan_file.unlink(missing_ok=True)
        elif len(kept) < len(older["records"]):
            write_atomic(plan_file, json.dumps({**older, "records": kept}))
    for video in videos:
        if (read_record(record_path(video)) or {}).get("state") in ("running", "waiting"):
            continue
        write_record({"video": video, "stage": "queued", "state": "queued", "frames": frames_of[video], "started": now, "updated": now,
                      "pid": 0, "work": work_name()})
    write_atomic(plan_path(now), json.dumps({"records": names, "created": now, "pid": runner or os.getppid()}))
    refresh()


def editing(video, file=None):
    """A session or agent wrote this edit's spec `file` (hooks/render-progress-editing.sh): it shows as editing until
    EDITING_IDLE passes without another write (a later write starts afresh) or a render stage starts."""
    path = editing_path(video)
    with progress_store.locked(path):  # agents writing the same edit at once would each count from the same mark
        now = time.time()
        before = read_record(path) or {}
        if now - before.get("updated", 0) > EDITING_IDLE:
            before = {"started": now, "writes": 0, "file": ""}
        write_atomic(path, json.dumps({"video": video, "state": "editing", "started": before["started"], "updated": now,
                                       "file": file or before.get("file", ""), "writes": before.get("writes", 0) + 1, "work": work_name()}))
    refresh()


def announce(path, record):
    milestone = f"{path.stem}-{record['stage']}-{record['state']}-{int(record['started'])}"
    if record["state"] == "done" and record["stage"] == "master" and claim(milestone):
        notify.toast(f"{record['video']} is done", record["work"])
    elif record["state"] in ("failed", "stopped") and claim(milestone):
        notify.toast(f"{record['video']} {record['stage']} {record['state']}", record["work"])


def snapshot(now=None):
    """Every edit as of `now`: dead renders read stopped, aged records and quiet editing marks go, and each milestone's
    toast fires once. The status line (refresh) and the live view (progress_watch) both read this."""
    now = now or time.time()
    records = {}
    for path in progress_store.PROGRESS.glob("*.json"):
        record = None if path.name.startswith("plan-") else read_record(path)
        if not record:
            continue
        if record["state"] in ("running", "waiting") and not alive(record["pid"]):
            record = {**record, "state": "stopped"}
            write_atomic(path, json.dumps(record))
        announce(path, record)
        records[path.name] = record
    aged = lambda record: record["state"] in KEEP and until(record) < now  # noqa: E731
    plans = []
    for plan_file in sorted(progress_store.PROGRESS.glob("plan-*.json")):
        plan_ = read_record(plan_file)
        if plan_ and plan_.get("pid") and not alive(plan_["pid"]):
            # The runner is gone: the edits it never started never will be.
            for name in [name for name in plan_["records"] if records.get(name, {}).get("state") == "queued"]:
                (progress_store.PROGRESS / name).unlink(missing_ok=True)
                del records[name]
        if plan_ and all(aged(records[name]) for name in plan_["records"] if name in records):
            plan_file.unlink(missing_ok=True)  # every edit finished and has been shown long enough
        elif plan_:
            plans.append(plan_)
    planned_names = {name for plan_ in plans for name in plan_["records"]}
    for name in [name for name, record in records.items() if aged(record) and name not in planned_names]:
        (progress_store.PROGRESS / name).unlink(missing_ok=True)
        del records[name]
    order = list(dict.fromkeys(name for plan_ in plans for name in plan_["records"] if name in records))
    order += sorted((name for name in records if name not in order), key=lambda name: records[name]["started"])
    active = [records[name] for name in order if records[name]["state"] in ACTIVE]
    finished = [records[name] for name in order if records[name]["state"] in ("failed", "stopped")]
    planned = [records[name] for name in dict.fromkeys(name for plan_ in plans for name in plan_["records"]) if name in records]
    edited = []
    for path in (progress_store.PROGRESS / "editing").glob("*.json"):
        mark, render = read_record(path), records.get(path.name)
        if not mark or until(mark) < now or (render and render["started"] >= mark["updated"]):
            path.unlink(missing_ok=True)  # gone quiet, or a render stage started after the last write
        else:
            edited.append(mark)
    edited.sort(key=lambda mark: mark["started"])
    running = {name: record for name, record in records.items() if record["state"] == "running"}
    return {"now": now, "active": active, "finished": finished, "planned": planned, "edited": edited, "history": read_history() if active else [],
            "running": running}


def leave_etas(running, history, now):
    """Each running record's etaS where hf/progress.js picks it up; a stage that ended takes its file with it."""
    for name, record in running.items():
        eta = progress_eta.eta_seconds(record, history, now)
        if eta is None:
            progress_store.eta_path(name).unlink(missing_ok=True)
        else:
            write_atomic(progress_store.eta_path(name), json.dumps({"stage": record["stage"], "started": record["started"], "etaS": eta}))
    for path in (progress_store.PROGRESS / "eta").glob("*.json"):
        if path.name not in running:
            path.unlink(missing_ok=True)


def refresh(now=None):
    """Rebuilds statusline.txt (expires|updated|active|text lines) from snapshot()."""
    snap = snapshot(now)
    now, active = snap["now"], snap["active"]
    leave_etas(snap["running"], snap["history"], now)
    if active:
        lines = [(now + LIVE, progress_eta.line(active, snap["finished"], snap["planned"], snap["history"], now, snap["edited"]))]
    else:
        lines = progress_eta.timeline(snap["finished"], snap["planned"], snap["edited"], now, until)
    write_atomic(progress_store.PROGRESS / "statusline.txt", "\n".join(f"{expires:.0f}|{now:.0f}|{int(bool(active))}|{text}" for expires, text in lines))
    return lines[0][1]


def until(record):
    """When a finished record or an editing mark leaves the line."""
    return record["updated"] + (EDITING_IDLE if record["state"] == "editing" else KEEP[record["state"]])


def main(args):
    command = args[0] if args else "status"
    if command == "plan":
        runner = int(args[2]) if args[1:2] == ["--runner"] else None
        videos = args[3:] if runner else args[1:]
        plan(videos, {video: load_edl(video)["frames"] for video in videos}, runner)
    elif command == "editing":
        editing(args[1], args[3] if args[2:3] == ["--file"] else None)
    elif command == "refresh":
        refresh()
    else:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # the line's emoji crash a cp1252 console's print
        print(refresh() or "no renders running")


if __name__ == "__main__":
    main(sys.argv[1:])
