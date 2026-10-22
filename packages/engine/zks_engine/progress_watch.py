# Created by The Angelo Umali.
# The live view behind /zk:render-status: every render's stage, bar, % and ETA, the queue, failures, and the spec each
# agent is writing, redrawn in place with Claude Code's spinner. `--once` prints one plain frame (the command's chat
# snapshot). Usage: python -m zks_engine.progress_watch [--once]
import os
import subprocess
import sys
import threading
import time

from . import progress
from .progress_eta import clock, percent, simulate

def spinner(platform=sys.platform):
    """Claude Code's glyphs, out and back. Off macOS ✳ (U+2733) is an emoji, a green box in Windows Terminal, so `*`
    takes its place, as in Claude Code's own spinner."""
    glyphs = "·✢✳✶✻✽" if platform == "darwin" else "·✢*✶✻✽"
    return glyphs + glyphs[-2:0:-1]


SPINNER = spinner()
GERUNDS = ("Cooking", "Simmering", "Brewing", "Stirring", "Plating", "Rendering")
GERUND_SECONDS = 3
STAGE_WORDS = {
    "transcribe": "transcribing the voice",
    "join": "joining the clips",
    "audio": "mixing the voice",
    "events": "placing the sound cues",
    "sfx": "mixing the sound effects",
    "frames": "drawing overlay frames",
    "master": "encoding the 4K master",
}
SLOT_OF = {"frames": "overlay", "transcribe": "whisper"}  # every other stage waits for the GPU slot
BAR = 12
WIDTH = 88
FPS = 10


def bar(done, total):
    """A cell fills only once it is earned, so 1 frame of 300 still reads empty."""
    filled = BAR * done // total if total else 0
    return "█" * filled + "░" * (BAR - filled)


def left(finish, now):
    """The ETA and the time to it; ⏱ draws two cells wide in Windows Terminal, so a space keeps the clock clear."""
    seconds = max(0, finish - now)
    return f"⏱ {clock(finish)} ({round(seconds)}s)" if seconds < 60 else f"⏱ {clock(finish)} ({round(seconds / 60)}m)"


def ago(seconds):
    return f"{int(seconds)}s" if seconds < 60 else f"{int(seconds // 60)}m"


def counted(count, word):
    return f"{count} {word}{'' if count == 1 else 's'}"


def frame(snap, now, tick, gpu=None, color=False):
    """One frame of the view as lines, from progress.snapshot(). Pure: `now` turns the header, `tick` the spinner."""
    def paint(code, text):
        return f"\x1b[{code}m{text}\x1b[0m" if color else text

    def spin(offset):
        return paint("38;5;209", SPINNER[(tick + offset) % len(SPINNER)])

    active, edited = snap["active"], snap["edited"]
    finish, batch = simulate(active, snap["history"], now)
    if active:
        title = f"{GERUNDS[int(now // GERUND_SECONDS) % len(GERUNDS)]} {counted(len(active), 'edit')}…"
    elif edited:
        title = f"Writing {counted(len(edited), 'edit')}…"
    else:
        title = "Nothing cooking"
    status = time.strftime("%H:%M:%S", time.localtime(now)) + (f" · GPU {gpu[0]}% · NVENC {gpu[1]}%" if gpu else "")
    rows = []
    for index, edit in enumerate(active):
        video, offset = f"{edit['video']:<6}", index * 2  # rows spin out of step
        if edit["state"] == "queued":
            rows.append(f" {paint('2', '·')} {video} {'queued':<26} {'':{BAR + 5}}  {left(finish[edit['video']], now)}")
        elif edit["state"] == "waiting":
            rows.append(f" {spin(offset)} {video} waiting for the {SLOT_OF.get(edit['stage'], 'GPU')} slot")
        else:
            share = f"{paint('32', bar(edit['done'], edit['total']))} {percent(edit):>3}%" if edit.get("total") else " " * (BAR + 5)
            rows.append(f" {spin(offset)} {video} {STAGE_WORDS.get(edit['stage'], edit['stage']):<26} {share}  {left(finish[edit['video']], now)}")
    for mark in edited:
        rows.append(f" ✍ {mark['video']:<6} agent writing {mark.get('file') or 'specs'} · {counted(mark.get('writes', 1), 'write')} · "
                    f"{ago(now - mark['updated'])} ago · since {clock(mark['started'])}")
    for edit in snap["finished"]:  # a failure is written as it happens; a stop is only noticed after the last heartbeat
        when = f"failed at {clock(edit['updated'])}" if edit["state"] == "failed" else f"stopped · last heard {clock(edit['updated'])}"
        rows.append(f" {'❌' if edit['state'] == 'failed' else '⚠'} {edit['video']:<6} {edit['stage']} {when}")
    rows = rows or [paint("2", " nothing rendering, and no agent is writing specs")]
    foot = [f"all {left(batch, now)}"] if len(active) > 1 else []
    if snap["planned"]:
        foot.append(f"✅ {sum(edit['state'] == 'done' for edit in snap['planned'])}/{len(snap['planned'])}")
    rule = paint("2", "─" * WIDTH)
    head = f" {spin(0) if active or edited else '·'} {paint('1', title)}"
    return [f"{head}  {paint('2', status)}", rule, *rows, rule, " " + " · ".join(foot)]


def read_gpu():
    """(GPU %, NVENC %) from nvidia-smi, or None without one."""
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=utilization.gpu,utilization.encoder", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=5, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        gpu, nvenc = out.stdout.splitlines()[0].split(",")
        return int(gpu), int(nvenc)
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None


class Gpu:
    """nvidia-smi every 2 s on its own thread: a slow call never stalls the redraw."""

    def __init__(self):
        self.reading = read_gpu()
        threading.Thread(target=self.poll, daemon=True).start()

    def poll(self):
        while True:
            time.sleep(2)
            self.reading = read_gpu()


def escapes_on():
    """A classic Windows console prints escape codes raw until VT processing is on (Windows Terminal has it already)."""
    if os.name == "nt":
        import ctypes

        console, mode = ctypes.windll.kernel32, ctypes.c_uint32()
        handle = console.GetStdHandle(-11)  # stdout
        if console.GetConsoleMode(handle, ctypes.byref(mode)):
            console.SetConsoleMode(handle, mode.value | 0x0004)  # ENABLE_VIRTUAL_TERMINAL_PROCESSING


def live():
    """Redraws in place 10 times a second (home, then clear each line's tail) and reads the records once a second."""
    escapes_on()
    gpu, snap, fetched, tick = Gpu(), None, 0.0, 0
    sys.stdout.write("\x1b]0;ZKidz renders\x07\x1b[?25l\x1b[2J")
    try:
        while True:
            now = time.time()
            if now - fetched >= 1:
                snap, fetched = progress.snapshot(now), now
            lines = frame(snap, now, tick, gpu.reading, color=True) + ["", " \x1b[2mCtrl+C closes\x1b[0m"]
            sys.stdout.write("\x1b[H" + "\n".join(line + "\x1b[K" for line in lines) + "\x1b[J")
            sys.stdout.flush()
            tick += 1
            time.sleep(1 / FPS)
    except KeyboardInterrupt:
        pass
    finally:
        sys.stdout.write("\x1b[?25h\n")
        sys.stdout.flush()


def main(args):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # the glyphs crash a cp1252 console's print
    if "--once" in args:
        snap = progress.snapshot()
        print("\n".join(frame(snap, snap["now"], SPINNER.index("✻"), read_gpu())))  # a still frame shows a full glyph
    else:
        live()


if __name__ == "__main__":
    main(sys.argv[1:])
