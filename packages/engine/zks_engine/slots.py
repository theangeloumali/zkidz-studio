# Created by The Angelo Umali.
# Machine-wide slots for heavy work, shared by every session and worktree: a GPU master, overlay frame drawing, whisper.
# A slot is a lock file created exclusively (hf/slots.js speaks the same format). A holder that died, or a lock
# older than STALE_HOURS, is reclaimed, so a crashed render never blocks the machine.
import contextlib
import json
import os
import time

import psutil

from .home import data_dir

LOCKS = data_dir("locks")
# One of each kind at a time: a master already runs RENDER_JOBS chunks (NVENC 70-99%), overlay drawing ~12 Chrome pages,
# whisper most CPU cores. Two of a kind only slow both, and stacked CPU work once hung the desktop.
SLOTS = {"gpu": 1, "overlay": 1, "whisper": 1}
POLL_SECONDS = 5
STALE_HOURS = 12
UNREADABLE_GRACE = 60  # seconds a just-created lock may stay empty while its owner writes it


def alive(pid):
    """Never signal a pid to probe it: on Windows os.kill terminates the process (psutil asks OpenProcess there).
    A zombie is dead: its lock must be reclaimed though signal 0 still reaches it."""
    try:
        return psutil.Process(pid).status() != psutil.STATUS_ZOMBIE
    except psutil.NoSuchProcess:
        return False
    except psutil.AccessDenied:
        return True


def holder(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def is_stale(path):
    info = holder(path)
    if info is None:
        try:
            return time.time() - path.stat().st_mtime > UNREADABLE_GRACE
        except OSError:
            return False  # already released
    return not alive(info["pid"]) or time.time() - info["since"] > STALE_HOURS * 3600


def try_take(path, label):
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return False
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump({"pid": os.getpid(), "label": label, "since": time.time()}, handle)
    return True


def release(path):
    if (holder(path) or {}).get("pid") == os.getpid():  # a lock reclaimed from us as stale belongs to someone else now
        path.unlink(missing_ok=True)


@contextlib.contextmanager
def slot(kind, label, on_wait=None):
    """Holds one `kind` slot for the with-block, waiting (and saying so once, to on_wait too) while another session holds it."""
    LOCKS.mkdir(parents=True, exist_ok=True)
    paths = [LOCKS / f"{kind}-{index}.lock" for index in range(SLOTS[kind])]
    announced = False
    while True:
        for path in paths:
            if try_take(path, label):
                try:
                    yield
                finally:
                    release(path)
                return
            if is_stale(path):
                path.unlink(missing_ok=True)
        if not announced:
            held = "; ".join((holder(path) or {}).get("label", "?") for path in paths)
            print(f"waiting for the {kind} slot, held by: {held}", flush=True)
            if on_wait:
                on_wait()
            announced = True
        time.sleep(POLL_SECONDS)
