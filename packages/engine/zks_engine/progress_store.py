# Created by The Angelo Umali.
# Where render progress lives and how it is written: one JSON record per edit per work dir, written atomically, the
# stage history the ETAs learn from, and one-time claims for toasts. progress.js writes the same records.
import contextlib
import hashlib
import json
import os
import time
from pathlib import Path

from .home import data_dir
from .pipeline import WORK

PROGRESS = data_dir("progress")


def work_name():
    return str(WORK)


def record_path(video):
    """One record per edit per work dir; progress.js keys the work dir the same way (normalised, lower case on Windows)."""
    work = os.path.normcase(os.path.abspath(work_name()))
    return PROGRESS / f"{hashlib.sha1(work.encode()).hexdigest()[:8]}-{video}.json"


def editing_path(video):
    """An edit's editing mark sits beside its render record, never in it, so it can never overwrite a render's write."""
    return PROGRESS / "editing" / record_path(video).name


def read_record(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def write_atomic(path, text):
    """tmp + replace; a reader holding the file (Windows) can refuse the replace, so retry briefly, then let the next write win."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    tmp.write_text(text, encoding="utf-8")
    for _ in range(5):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            time.sleep(0.05)
    tmp.unlink(missing_ok=True)


def write_record(record):
    write_atomic(record_path(record["video"]), json.dumps(record))


def read_history():
    try:
        return [json.loads(line) for line in (PROGRESS / "history.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    except (OSError, ValueError):
        return []


@contextlib.contextmanager
def locked(path, patience=2.0, stale=10.0):
    """Serialises a quick read-modify-write of `path` across processes (an exclusive `.lock` beside it). Fails open
    after `patience`, so a hook never hangs, and breaks a lock older than `stale`, left by a holder that died."""
    lock = path.with_name(path.name + ".lock")
    lock.parent.mkdir(parents=True, exist_ok=True)
    deadline, held = time.time() + patience, False
    while not held and time.time() < deadline:
        try:
            os.close(os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
            held = True
        except FileExistsError:
            with contextlib.suppress(OSError):
                if time.time() - lock.stat().st_mtime > stale:
                    lock.unlink()
            time.sleep(0.01)
    try:
        yield
    finally:
        if held:
            lock.unlink(missing_ok=True)


def claim(name):
    """True for exactly one caller per milestone, across processes (an exclusive marker file)."""
    folder = PROGRESS / "notified"
    folder.mkdir(parents=True, exist_ok=True)
    try:
        os.close(os.open(folder / name, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
        return True
    except FileExistsError:
        return False
