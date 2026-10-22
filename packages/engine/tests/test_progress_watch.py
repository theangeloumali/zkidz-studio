# Created by The Angelo Umali.
# The live view behind /zk:render-status: one frame per snapshot, the spinner and header moving with the clock, and a
# plain --once frame for the command's chat snapshot.
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from support import ENGINE  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import progress_watch

NOW = 1_800_000_000.0
clock = lambda epoch: time.strftime("%H:%M", time.localtime(epoch))  # noqa: E731


def edit(video, stage, state="running", done=0, total=None, started=NOW - 60, updated=NOW):
    return {"video": video, "stage": stage, "state": state, "done": done, "total": total, "frames": total or 300, "started": started,
            "updated": updated, "pid": 1, "work": "w"}


def snap(active=(), finished=(), planned=(), edited=()):
    return {"now": NOW, "active": list(active), "finished": list(finished), "planned": list(planned), "edited": list(edited), "history": []}


def text(lines):
    return "\n".join(lines)


class FrameTests(unittest.TestCase):
    def test_a_running_stage_has_its_words_bar_share_and_eta(self):
        lines = progress_watch.frame(snap([edit("v1", "frames", done=150, total=300)]), NOW, 0)
        row = next(line for line in lines if "v1" in line)
        self.assertIn("drawing overlay frames", row)
        self.assertIn("█" * 6 + "░" * 6, row)
        self.assertIn("50%", row)
        self.assertRegex(row, r"⏱ \d\d:\d\d \(\d+m\)")

    def test_queued_waiting_editing_and_failed_rows(self):
        lines = text(progress_watch.frame(snap(
            active=[edit("v1", "master", done=10, total=300), edit("v2", "frames", state="waiting"), edit("v3", "queued", state="queued")],
            finished=[edit("v4", "sfx", state="failed", updated=NOW - 120)],
            edited=[{"video": "v5", "state": "editing", "started": NOW - 600, "updated": NOW - 40, "file": "cues/v5r.js", "writes": 3}],
        ), NOW, 0))
        self.assertIn("encoding the 4K master", lines)
        self.assertIn("v2", lines)
        self.assertIn("waiting for the overlay slot", lines)
        self.assertRegex(lines, r"v3 +queued +⏱ \d\d:\d\d")
        self.assertIn(f"agent writing cues/v5r.js · 3 writes · 40s ago · since {clock(NOW - 600)}", lines)
        self.assertRegex(lines, rf"v4 +sfx failed at {clock(NOW - 120)}")

    def test_a_stopped_render_names_when_it_was_last_heard(self):
        lines = text(progress_watch.frame(snap(finished=[edit("v6", "master", state="stopped", updated=NOW - 300)]), NOW, 0))
        self.assertRegex(lines, rf"⚠ v6 +master stopped · last heard {clock(NOW - 300)}")

    def test_the_spinner_turns_and_the_header_rotates(self):
        busy = snap([edit("v1", "frames", done=1, total=300)])
        glyphs = {progress_watch.frame(busy, NOW, tick)[0][1] for tick in range(len(progress_watch.SPINNER))}
        self.assertGreater(len(glyphs), 3)
        headers = {progress_watch.frame(busy, NOW + seconds, 0)[0].split()[1] for seconds in range(0, 30, 3)}
        self.assertGreater(len(headers), 3)
        self.assertTrue(headers <= set(progress_watch.GERUNDS))

    def test_off_macos_the_spinner_has_no_emoji_glyph(self):
        self.assertNotIn("✳", progress_watch.spinner("win32"))  # Windows Terminal draws U+2733 as a green emoji box
        self.assertEqual(progress_watch.spinner("darwin"), "·✢✳✶✻✽✻✶✳✢")

    def test_idle_and_writing_only(self):
        self.assertIn("Nothing cooking", progress_watch.frame(snap(), NOW, 0)[0])
        writing = snap(edited=[{"video": "v5", "state": "editing", "started": NOW, "updated": NOW, "file": "cuts/v5.json", "writes": 1}])
        self.assertIn("Writing 1 edit", progress_watch.frame(writing, NOW, 0)[0])

    def test_bar_edges(self):
        self.assertEqual(progress_watch.bar(0, 300), "░" * progress_watch.BAR)
        self.assertEqual(progress_watch.bar(300, 300), "█" * progress_watch.BAR)
        self.assertEqual(progress_watch.bar(1, 300), "░" * progress_watch.BAR)  # a cell fills only once it is earned

    def test_the_last_minute_counts_seconds(self):
        self.assertEqual(progress_watch.left(NOW + 45, NOW), f"⏱ {clock(NOW + 45)} (45s)")
        self.assertEqual(progress_watch.left(NOW + 600, NOW), f"⏱ {clock(NOW + 600)} (10m)")

    def test_a_batch_footer_counts_and_times_the_batch(self):
        lines = text(progress_watch.frame(snap(active=[edit("v1", "master", done=10, total=300), edit("v2", "queued", state="queued")],
                                               planned=[edit("v0", "master", state="done"), edit("v1", "master"), edit("v2", "queued", state="queued")]),
                                          NOW, 0, gpu=(87, 64)))
        self.assertRegex(lines, r"all ⏱ \d\d:\d\d \(\d+m\) · ✅ 1/3")
        self.assertIn("GPU 87% · NVENC 64%", lines)


class OnceTests(unittest.TestCase):
    def test_once_prints_one_plain_frame(self):
        with tempfile.TemporaryDirectory() as folder:
            env = {**os.environ, "ZKS_PROGRESS": folder, "ZKS_TOASTS": "0", "PYTHONIOENCODING": "utf-8"}
            Path(folder, "aaaaaaaa-v1.json").write_text(
                '{"video": "v1", "stage": "frames", "state": "running", "done": 75, "total": 300, "unit": "frames", "frames": 300, '
                f'"started": {time.time() - 30}, "updated": {time.time()}, "pid": {os.getpid()}, "work": "w"}}', encoding="utf-8")
            out = subprocess.run([sys.executable, "-m", "zks_engine.progress_watch", "--once"], capture_output=True, env=env, timeout=60)
        stdout = out.stdout.decode("utf-8")
        self.assertEqual(out.returncode, 0, out.stderr.decode("utf-8", "replace"))
        self.assertIn("drawing overlay frames", stdout)
        self.assertIn("25%", stdout)
        self.assertNotIn("\x1b", stdout)


if __name__ == "__main__":
    unittest.main()
