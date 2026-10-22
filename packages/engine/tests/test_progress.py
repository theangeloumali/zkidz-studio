# Created by The Angelo Umali.
# Render progress: each stage's record, the line the status line reads, the ETA model and the one-time toasts.
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from support import ENGINE  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import notify
from zks_engine import progress
from zks_engine import progress_eta
from zks_engine import progress_store

NOW = 1_800_000_000.0
clock = lambda epoch: time.strftime("%H:%M", time.localtime(epoch))  # noqa: E731


class ProgressCase(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.dir = Path(folder.name)
        for module, name, value in ((progress_store, "PROGRESS", self.dir), (progress, "THROTTLE", 0)):
            patcher = mock.patch.object(module, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.toasts = []
        patcher = mock.patch.object(notify, "toast", lambda title, body: self.toasts.append((title, body)))
        patcher.start()
        self.addCleanup(patcher.stop)

    def records(self):
        return {record["video"]: record for record in map(progress.read_record, self.dir.glob("*.json")) if record and "video" in record}

    def line(self):
        return self.timeline()[0]

    def timeline(self):
        rows = [row.split("|", 3) for row in (self.dir / "statusline.txt").read_text(encoding="utf-8").splitlines()]
        return [(float(expires), float(updated), active, text) for expires, updated, active, text in rows]


class JobTests(ProgressCase):
    def test_a_stage_runs_then_finishes_and_feeds_the_history(self):
        with progress.job("v1", "master", total=300, frames=300) as stage:
            stage.update(150)
            record = self.records()["v1"]
            self.assertEqual((record["stage"], record["state"], record["done"], record["total"], record["pid"]), ("master", "running", 150, 300, os.getpid()))
        self.assertEqual(self.records()["v1"]["state"], "done")
        history = [json.loads(line) for line in (self.dir / "history.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertEqual((history[-1]["stage"], history[-1]["units"]), ("master", 300))

    def test_a_failure_is_recorded_toasted_once_and_raised(self):
        with self.assertRaises(RuntimeError), progress.job("v1", "frames", total=100):
            raise RuntimeError("hyperframes render failed")
        self.assertEqual(self.records()["v1"]["state"], "failed")
        progress.refresh()
        self.assertEqual(self.toasts, [("v1 frames failed", progress.work_name())])

    def test_a_clean_system_exit_is_done_and_a_message_is_a_failure(self):
        with self.assertRaises(SystemExit), progress.job("v1", "sfx"):
            sys.exit(0)
        self.assertEqual(self.records()["v1"]["state"], "done")
        with self.assertRaises(SystemExit), progress.job("v2", "sfx"):
            sys.exit("v2: edit.wav does not match the edit")
        self.assertEqual(self.records()["v2"]["state"], "failed")

    def test_a_stage_waits_for_its_slot_then_begins_with_its_total(self):
        with progress.job("v1", "master", frames=300) as stage:
            stage.wait()
            self.assertEqual(self.records()["v1"]["state"], "waiting")
            stage.begin(360)
            record = self.records()["v1"]
            self.assertEqual((record["state"], record["total"]), ("running", 360))

    def test_a_quiet_stage_still_beats(self):
        with mock.patch.object(progress, "HEARTBEAT", 0.2), progress.job("v1", "join") as stage:
            first = self.records()["v1"]["updated"]
            time.sleep(0.6)
            self.assertGreater(self.records()["v1"]["updated"], first)
        self.assertEqual(self.records()["v1"]["state"], "done")
        del stage

    def test_updates_are_throttled(self):
        with mock.patch.object(progress, "THROTTLE", 60), progress.job("v1", "master", total=300) as stage:
            stage.update(10)
            stage.update(20)
            self.assertEqual(self.records()["v1"]["done"], 0)

    def test_a_master_done_is_toasted_once(self):
        with progress.job("v1", "master", total=10, frames=10):
            pass
        progress.refresh()
        progress.refresh()
        self.assertEqual(self.toasts, [("v1 is done", progress.work_name())])

    def test_a_running_stage_whose_process_died_reads_stopped(self):
        finished = subprocess.run([sys.executable, "-c", "import os; print(os.getpid())"], capture_output=True, text=True)
        record = {"video": "v1", "stage": "frames", "state": "running", "done": 5, "total": 100, "unit": "frames", "frames": 100,
                  "started": time.time() - 30, "updated": time.time() - 30, "pid": int(finished.stdout), "work": progress.work_name()}
        progress.write_record(record)
        progress.refresh()
        self.assertIn("⚠ v1 stopped", self.line()[3])
        progress.refresh()
        self.assertEqual(self.toasts, [("v1 frames stopped", progress.work_name())])


class LineTests(ProgressCase):
    def test_nothing_running_writes_an_empty_line(self):
        progress.refresh()
        self.assertEqual(self.line()[2:], ("0", ""))

    def test_a_planned_batch_shows_the_running_edit_the_queue_and_both_etas(self):
        progress.plan(["v1", "v2"], {"v1": 2000, "v2": 3000})
        with progress.job("v1", "frames", total=2000, frames=2000) as stage:
            stage.update(1000)
            expires, updated, active, text = self.line()
        self.assertGreater(expires, updated)
        self.assertEqual(active, "1")
        self.assertRegex(text, r"^🎬 v1 frames 50% ⏱ \d\d:\d\d · \+1 queued · all ⏱ \d\d:\d\d · ✅ 0/2$")


    def test_a_batch_keeps_counting_an_edit_that_finished_long_ago(self):
        progress.plan(["v1", "v2"], {"v1": 100, "v2": 100})
        with progress.job("v1", "master", total=100, frames=100):
            pass
        record = progress.read_record(progress.record_path("v1"))
        progress.write_record({**record, "updated": record["updated"] - 3600})
        with progress.job("v2", "frames", total=100, frames=100):
            self.assertRegex(self.line()[3], r"✅ 1/2$")


    def test_re_planning_an_edit_moves_it_to_the_new_batch(self):
        progress.plan(["v1", "v2"], {"v1": 100, "v2": 100})
        progress.plan(["v1"], {"v1": 100})
        with progress.job("v1", "frames", total=100, frames=100):
            text = self.line()[3]
        self.assertEqual(text.count("v1 frames"), 1)
        self.assertRegex(text, r"\+1 queued · all ⏱ \d\d:\d\d · ✅ 0/2$")

    def test_re_planning_in_the_same_instant_keeps_both_batches(self):
        # Two plans inside one clock tick (fast machines, coarse Windows clocks) once shared a file name.
        with mock.patch.object(progress.time, "time", return_value=1_000_000.0):
            progress.plan(["v1", "v2"], {"v1": 100, "v2": 100})
            progress.plan(["v1"], {"v1": 100})
        self.assertEqual(len(list(progress_store.PROGRESS.glob("plan-*.json"))), 2)

    def test_a_dead_runners_queue_is_dropped(self):
        finished = subprocess.run([sys.executable, "-c", "import os; print(os.getpid())"], capture_output=True, text=True)
        progress.plan(["v1", "v2"], {"v1": 100, "v2": 100}, runner=int(finished.stdout))
        progress.refresh()
        self.assertEqual(self.line()[2:], ("0", ""))
        self.assertEqual(list(self.dir.glob("plan-*.json")), [])


    def test_the_runner_names_itself(self):
        # Under Git Bash python's parent is a short-lived forked bash, not the runner: the runner passes its own pid.
        runner = self.sleeper()
        with mock.patch.object(progress, "load_edl", lambda video: {"frames": 100}):
            progress.main(["plan", "--runner", str(runner.pid), "v1", "v2"])
        [plan] = [progress.read_record(path) for path in self.dir.glob("plan-*.json")]
        self.assertEqual(plan["pid"], runner.pid)
        self.assertRegex(self.line()[3], r"✅ 0/2$")

    def test_status_prints_the_line_on_a_cp1252_console(self):
        sleeper = self.sleeper()
        progress.write_record({"video": "v1", "stage": "frames", "state": "running", "done": 5, "total": 10, "unit": "frames", "frames": 10,
                               "started": time.time(), "updated": time.time(), "pid": sleeper.pid, "work": progress.work_name()})
        env = {**os.environ, "ZKS_PROGRESS": str(self.dir), "PYTHONIOENCODING": "cp1252", "ZKS_TOASTS": "0"}
        result = subprocess.run([sys.executable, "-m", "zks_engine.progress", "status"], capture_output=True, env=env)
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))
        self.assertIn("🎬 v1 frames 50%", result.stdout.decode("utf-8"))

    def sleeper(self):
        process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        self.addCleanup(process.kill)
        return process


class EditingTests(ProgressCase):
    def mark(self, video):
        return progress.read_record(progress.editing_path(video))

    def shift(self, video, **seconds):
        """Moves a mark's timestamps back, as if its writes were that long ago."""
        mark = self.mark(video)
        progress.write_atomic(progress.editing_path(video), json.dumps({**mark, **{key: mark[key] - value for key, value in seconds.items()}}))
        return self.mark(video)

    def test_an_edit_being_written_shows_since_when(self):
        progress.editing("v1")
        expires, updated, active, text = self.line()
        self.assertEqual((active, text), ("0", f"🎬 ✏️ v1 editing since {clock(self.mark('v1')['started'])}"))
        self.assertAlmostEqual(expires, updated + progress.EDITING_IDLE, delta=1)

    def test_repeat_writes_keep_the_start(self):
        progress.editing("v1")
        mark = self.shift("v1", started=720)
        progress.editing("v1")
        self.assertEqual(self.line()[3], f"🎬 ✏️ v1 editing since {clock(mark['started'])}")

    def test_a_write_after_an_idle_gap_starts_afresh(self):
        progress.editing("v1")
        self.shift("v1", started=3600, updated=progress.EDITING_IDLE + 5)
        progress.editing("v1")
        self.assertAlmostEqual(self.mark("v1")["started"], time.time(), delta=5)

    def test_each_edit_leaves_the_line_when_it_goes_quiet(self):
        progress.editing("v1")
        progress.editing("v2")
        v1 = self.shift("v1", updated=300)
        progress.refresh()
        v2 = self.mark("v2")
        lines = [(expires, text) for expires, _, _, text in self.timeline()]
        self.assertEqual([text for _, text in lines],
                         [f"🎬 ✏️ v1 editing since {clock(v1['started'])} · ✏️ v2 editing since {clock(v2['started'])}",
                          f"🎬 ✏️ v2 editing since {clock(v2['started'])}"])
        self.assertAlmostEqual(lines[0][0], v1["updated"] + progress.EDITING_IDLE, delta=1)
        self.assertAlmostEqual(lines[1][0], v2["updated"] + progress.EDITING_IDLE, delta=1)

    def test_a_failure_outlasts_an_edit_going_quiet(self):
        with self.assertRaises(RuntimeError), progress.job("v1", "frames", total=100):
            raise RuntimeError("hyperframes render failed")
        progress.editing("v2")
        v2 = self.shift("v2", updated=590)
        progress.refresh()
        failed = self.records()["v1"]
        lines = [(expires, text) for expires, _, _, text in self.timeline()]
        self.assertEqual([text for _, text in lines], [f"🎬 ❌ v1 frames failed · ✏️ v2 editing since {clock(v2['started'])}", "🎬 ❌ v1 frames failed"])
        self.assertAlmostEqual(lines[1][0], failed["updated"] + progress.KEEP["failed"], delta=1)

    def test_a_quiet_edit_is_dropped_without_a_toast(self):
        progress.editing("v1")
        self.shift("v1", updated=progress.EDITING_IDLE + 5)
        progress.refresh()
        self.assertEqual(self.line()[2:], ("0", ""))
        self.assertIsNone(self.mark("v1"))
        self.assertEqual(self.toasts, [])

    def test_editing_never_writes_a_render_record(self):
        with progress.job("v1", "frames", total=100, frames=100) as stage:
            stage.update(50)
            before = progress.record_path("v1").read_bytes()
            progress.editing("v1")
            self.assertEqual(progress.record_path("v1").read_bytes(), before)
            self.assertRegex(self.line()[3], r"^🎬 v1 frames 50% ⏱ \d\d:\d\d · ✏️ v1 editing since \d\d:\d\d$")

    def test_a_dead_render_does_not_hide_an_edit(self):
        finished = subprocess.run([sys.executable, "-c", "import os; print(os.getpid())"], capture_output=True, text=True)
        progress.write_record({"video": "v1", "stage": "frames", "state": "running", "done": 5, "total": 100, "unit": "frames", "frames": 100,
                               "started": time.time() - 60, "updated": time.time() - 60, "pid": int(finished.stdout), "work": progress.work_name()})
        progress.editing("v1")
        self.assertRegex(self.line()[3], r"^🎬 ⚠ v1 stopped · ✏️ v1 editing since \d\d:\d\d$")

    def test_a_render_stage_takes_over_and_runs_beside_other_editing(self):
        progress.editing("v1")
        progress.editing("v2")
        with progress.job("v1", "frames", total=100, frames=100) as stage:
            stage.update(50)
            expires, updated, active, text = self.line()
        self.assertEqual(active, "1")
        self.assertRegex(text, r"^🎬 v1 frames 50% ⏱ \d\d:\d\d · ✏️ v2 editing since \d\d:\d\d$")
        self.assertIsNone(self.mark("v1"))

    def test_the_cli_marks_an_edit(self):
        progress.main(["editing", "v1"])
        self.assertEqual(self.mark("v1")["video"], "v1")

    def test_a_mark_names_the_latest_file_and_counts_writes(self):
        progress.main(["editing", "v1", "--file", "cues/v1.js"])
        progress.main(["editing", "v1", "--file", "cuts/v1.json"])
        progress.editing("v1")  # an older hook passes no file: the last one stays
        self.assertEqual((self.mark("v1")["file"], self.mark("v1")["writes"]), ("cuts/v1.json", 3))
        self.shift("v1", updated=progress.EDITING_IDLE + 5)
        progress.editing("v1", "cues/v1r.js")
        self.assertEqual((self.mark("v1")["file"], self.mark("v1")["writes"]), ("cues/v1r.js", 1))

    def test_agents_writing_at_once_count_every_write(self):
        env = {**os.environ, "ZKS_PROGRESS": str(self.dir), "ZKS_WORK": progress.work_name(), "ZKS_TOASTS": "0"}
        writers = [subprocess.Popen([sys.executable, "-c", "from zks_engine import progress; progress.editing('v1', 'cues/v1.js')"], cwd=ENGINE, env=env)
                   for _ in range(6)]
        self.assertEqual([writer.wait(timeout=60) for writer in writers], [0] * 6)
        self.assertEqual(self.mark("v1")["writes"], 6)
        self.assertEqual(list(self.dir.glob("editing/*.lock")), [])

    def test_the_snapshot_feeds_the_line(self):
        progress.editing("v2", "cues/v2.js")
        with progress.job("v1", "frames", total=100, frames=100) as stage:
            stage.update(50)
            snap = progress.snapshot()
            self.assertEqual(([edit["video"] for edit in snap["active"]], [mark["video"] for mark in snap["edited"]]), (["v1"], ["v2"]))
            self.assertEqual(self.line()[3], progress.refresh())


class EtaTests(unittest.TestCase):
    def test_seed_rates_until_there_is_history(self):
        self.assertEqual(progress_eta.rate("master", []), progress_eta.SEED_RATES["master"])
        history = [{"stage": "master", "units": 600, "seconds": 10}] * 3
        self.assertEqual(progress_eta.rate("master", history), 60)

    def test_a_running_stage_trusts_its_own_pace_once_a_quarter_in(self):
        record = {"stage": "frames", "state": "running", "done": 500, "total": 1000, "started": NOW - 100}
        self.assertAlmostEqual(progress_eta.stage_left(record, [], NOW), 100)  # 5 fps measured, 100 s to go
        unstarted = {**record, "done": 0, "started": NOW - 20}
        self.assertAlmostEqual(progress_eta.stage_left(unstarted, [], NOW), 1000 / progress_eta.SEED_RATES["frames"])

    def test_an_early_pace_blends_with_history(self):
        # 10 % in after 60 s (a browser start-up inside): live says 540 s left, history 60 s; 40 % live.
        early = {"stage": "frames", "state": "running", "done": 100, "total": 1000, "started": NOW - 60}
        self.assertAlmostEqual(progress_eta.stage_left(early, [], NOW), 0.4 * 540 + 0.6 * 900 / progress_eta.SEED_RATES["frames"])

    def test_the_runner_pipeline_overlaps_a_master_with_the_next_edits_frames(self):
        # v1 is drawing (10 s of frames left), v2 waits: v1's master runs while v2 draws, v2's master after both.
        rates = {"frames": 10.0, "master": 100.0}
        with mock.patch.dict(progress_eta.SEED_RATES, rates), mock.patch.dict(progress_eta.FIXED_SECONDS, {"events": 0, "sfx": 0}):
            edits = [{"video": "v1", "stage": "frames", "state": "running", "done": 900, "total": 1000, "frames": 1000, "started": NOW - 90},
                     {"video": "v2", "stage": "queued", "state": "queued", "frames": 500}]
            finish, batch = progress_eta.simulate(edits, [], NOW)
        self.assertAlmostEqual(finish["v1"], NOW + 10 + 10)  # frames left, then its master
        self.assertAlmostEqual(finish["v2"], NOW + 10 + 50 + 5)  # v2 draws during v1's master, then its own master
        self.assertAlmostEqual(batch, finish["v2"])


class TimedStageTests(unittest.TestCase):
    def test_a_stage_without_units_is_timed_by_its_history(self):
        history = [{"stage": "join", "units": 0, "seconds": seconds} for seconds in (300, 360, 330)]
        self.assertEqual(progress_eta.stage_seconds("join", 1000, history), 330)
        record = {"stage": "join", "state": "running", "done": 0, "total": None, "started": NOW - 30}
        self.assertEqual(progress_eta.stage_left(record, history, NOW), 300)


class JsTwinTests(ProgressCase):
    def test_python_and_node_name_an_edit_alike(self):
        script = f"process.stdout.write(require({json.dumps(str(ENGINE / 'hf' / 'progress.js'))}).recordPath('v1'))"
        env = {**os.environ, "ZKS_PROGRESS": str(self.dir), "ZKS_WORK": str(progress_store.WORK).replace("\\", "/")}
        named = subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True, env=env).stdout
        self.assertEqual(Path(named).name, progress.record_path("v1").name)


class ToastTests(unittest.TestCase):
    def test_the_text_travels_in_the_environment_and_no_window_opens(self):
        args, env, flags = notify.toast_command("v1 is done", "C:/x'; Remove-Item -Recurse C:/")
        self.assertNotIn("Remove-Item", " ".join(args))
        self.assertEqual((env["ZKS_TOAST_TITLE"], env["ZKS_TOAST_BODY"]), ("v1 is done", "C:/x'; Remove-Item -Recurse C:/"))
        self.assertIn("-NonInteractive", args)
        if sys.platform == "win32":
            self.assertTrue(flags & 0x08000000)  # CREATE_NO_WINDOW


if __name__ == "__main__":
    unittest.main()
