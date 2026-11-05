# Created by The Angelo Umali.
# ingest's progress: a record per step (joining, audio, proxy) whose percent moves while ffmpeg runs, not only at the end.
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
import wave
from pathlib import Path
from unittest import mock

from support import ENGINE, has_ffmpeg  # first: it sets a scratch ZKS_HOME

from zks_engine import backends, cli, ffio, join_sources, prepare, progress, progress_store

ENGINE_TESTS = ENGINE / "tests"
FFMPEG_ABSENT = "needs ffmpeg and ffprobe"
# A stand-in ffmpeg: appends each (frame, out_time_us) step to the -progress file it was given, pausing between them.
WRITES_PROGRESS = (
    "import sys, time\n"
    "report = sys.argv[sys.argv.index('-progress') + 1]\n"
    "for frame, micros in [(int(step.split(':')[0]), int(step.split(':')[1])) for step in sys.argv[1].split(',')]:\n"
    "    open(report, 'a').write(f'frame={frame}\\nout_time_us={micros}\\nprogress=continue\\n')\n"
    "    time.sleep(0.4)\n"
)


def scratch_work(case):
    """Every engine module's WORK pointed at a scratch folder, so records, sources and the work key stay out of the real one."""
    folder = tempfile.TemporaryDirectory()
    case.addCleanup(folder.cleanup)
    work = Path(folder.name) / "work"
    work.mkdir()
    original = progress_store.WORK
    for module in list(sys.modules.values()):
        if getattr(module, "__name__", "").startswith("zks_engine") and getattr(module, "WORK", None) == original:
            patch = mock.patch.object(module, "WORK", work)
            patch.start()
            case.addCleanup(patch.stop)
    return work


class RecordedProgress(unittest.TestCase):
    """Every record a stage saves, in order (progress.Job.save writes through progress.write_record)."""

    def setUp(self):
        self.work = scratch_work(self)
        self.records = []
        real = progress.write_record

        def spy(record):
            self.records.append(dict(record))
            real(record)

        for patch in (mock.patch.object(progress, "write_record", spy), mock.patch.object(progress, "THROTTLE", 0),
                      mock.patch.object(ffio, "POLL_S", 0.05)):
            patch.start()
            self.addCleanup(patch.stop)

    def of(self, stage):
        return [record for record in self.records if record["stage"] == stage]

    def stages(self):
        return list(dict.fromkeys(record["stage"] for record in self.records))


class SecondsWrittenTests(unittest.TestCase):
    def report(self, text):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = Path(folder.name) / "ffmpeg.progress"
        path.write_text(text, encoding="utf-8")
        return path

    def test_reads_the_last_block(self):
        report = self.report("out_time_us=1000000\nprogress=continue\nout_time_us=2500000\nprogress=continue\n")
        self.assertEqual(ffio.seconds_written(report), 2.5)

    def test_is_zero_before_the_first_block_and_while_ffmpeg_prints_N_A(self):
        self.assertEqual(ffio.seconds_written(Path(tempfile.gettempdir()) / "zks-no-such-report.progress"), 0.0)
        self.assertEqual(ffio.seconds_written(self.report("out_time_us=N/A\nprogress=continue\n")), 0.0)


class RunReportingTests(RecordedProgress):
    def command(self, steps, exit_code=0):
        return [sys.executable, "-c", WRITES_PROGRESS + f"sys.exit({exit_code})\n", steps, "out.bin"]

    def test_reports_the_media_seconds_written_while_the_command_runs(self):
        seen = []
        ffio.run_reporting(self.command("10:1000000,20:2000000"), seen.append)
        self.assertIn(1.0, seen)
        self.assertEqual(seen, sorted(seen))
        self.assertEqual(seen[-1], 2.0)

    def test_a_failing_command_raises_like_subprocess_run_check(self):
        with self.assertRaises(subprocess.CalledProcessError) as raised:
            ffio.run_reporting(self.command("1:1000000", exit_code=3), lambda seconds: None)
        self.assertEqual(raised.exception.returncode, 3)

    def test_an_interrupted_wait_kills_the_command(self):
        slow = [sys.executable, "-c", "import time; time.sleep(60)", "out.bin"]
        started = time.monotonic()

        def interrupt(seconds):
            raise KeyboardInterrupt

        with mock.patch.object(ffio, "seconds_written", return_value=1.0), self.assertRaises(KeyboardInterrupt):
            ffio.run_reporting(slow, interrupt)
        self.assertLess(time.monotonic() - started, 20)


class RunAllReportTests(RecordedProgress):
    def commands(self):
        return [[sys.executable, "-c", WRITES_PROGRESS, steps, str(self.work / name)] for steps, name in (("10:0,25:0", "a.mp4"), ("5:0,15:0", "b.mp4"))]

    def test_sums_the_frames_both_pieces_have_written_while_they_run(self):
        seen = []
        self.assertEqual(join_sources.run_all(self.commands(), 2, seen.append), [])
        self.assertGreater(len(seen), 1)
        self.assertEqual(seen, sorted(seen))
        self.assertTrue(any(0 < frames < 40 for frames in seen), seen)
        self.assertEqual(seen[-1], 40)

    def test_without_a_report_the_commands_run_exactly_as_given(self):
        with mock.patch.object(join_sources.subprocess, "run", return_value=mock.Mock(returncode=0)) as run:
            join_sources.run_all([["ffmpeg", "-i", "in.mp4", "out.mp4"]], 1)
        self.assertEqual(run.call_args.args[0], ["ffmpeg", "-i", "in.mp4", "out.mp4"])

    def test_the_failed_exit_codes_come_back(self):
        failing = [sys.executable, "-c", "import sys; sys.exit(4)", "out.mp4"]
        self.assertEqual(join_sources.run_all([failing], 1, lambda frames: None), [4])


def call_cli(*args):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = cli.main(list(args))
    return code, json.loads(out.getvalue())


@unittest.skipUnless(has_ffmpeg(), FFMPEG_ABSENT)
class IngestStepsTests(RecordedProgress):
    def clip(self, name, seconds, with_audio=True, variable_rate=False):
        path = self.work.parent / "media" / name
        path.parent.mkdir(exist_ok=True)
        timing = ["-vf", "setpts='(N+0.4*sin(N))/(30*TB)'", "-fps_mode", "vfr"] if variable_rate else []
        sound = ["-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", "-c:a", "flac"] if with_audio else ["-an"]
        subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-f", "lavfi", "-i", f"testsrc2=size=180x320:rate=30:duration={seconds}", *sound,
                        *timing, "-c:v", "ffv1", str(path)], check=True)
        return path

    def ingest(self, *clips):
        code, _ = call_cli("ingest", "--json", "--video", "v1", "--mode", "join", *[arg for clip in clips for arg in ("--clip", str(clip))])
        self.assertEqual(code, 0)

    def assert_every_step_ran_to_its_total(self, order=("audio", "joining", "proxy")):
        self.assertEqual(self.stages(), list(order))
        for stage in self.stages():
            first, last = self.of(stage)[0], self.of(stage)[-1]
            self.assertEqual((first["state"], first["done"]), ("running", 0), stage)
            self.assertGreater(last["total"], 0, stage)
            self.assertEqual((last["state"], last["done"]), ("done", last["total"]), stage)

    def test_a_joined_pair_reports_joining_then_audio_then_proxy(self):
        self.ingest(self.clip("a.mkv", 0.5), self.clip("b.mkv", 1))
        self.assert_every_step_ran_to_its_total(("joining", "audio", "proxy"))
        self.assertEqual(self.of("joining")[-1]["total"], 45)
        self.assertEqual(self.of("audio")[-1]["unit"], "seconds")

    def test_one_clip_takes_its_audio_from_the_raw_before_the_join_trimmed_to_its_frames(self):
        self.ingest(self.clip("a.mkv", 1.2))
        self.assert_every_step_ran_to_its_total()
        with wave.open(str(self.work / "audio" / "v1.wav"), "rb") as audio:
            self.assertEqual(audio.getnframes(), 36 * 16000 // 30)
        self.assertEqual(list(self.work.joinpath("audio").iterdir()), [self.work / "audio" / "v1.wav"])

    def test_one_variable_rate_clip_reports_every_step_too(self):
        self.ingest(self.clip("phone.mkv", 1, variable_rate=True))
        self.assert_every_step_ran_to_its_total()

    def test_a_clip_with_no_audio_still_ingests_and_reports_every_step(self):
        self.ingest(self.clip("silent.mkv", 1, with_audio=False))
        self.assert_every_step_ran_to_its_total()

    def test_a_record_from_the_last_run_does_not_carry_its_progress_into_this_one(self):
        old = {"video": "v1", "stage": "master", "state": "done", "done": 500, "total": 500, "unit": "frames", "frames": 500, "started": 1.0,
               "updated": 2.0, "pid": 1, "work": str(self.work)}
        progress_store.write_record(old)
        began = time.time()
        self.ingest(self.clip("a.mkv", 0.5))
        first = self.records[0]
        self.assertEqual((first["stage"], first["state"], first["done"]), ("audio", "running", 0))
        self.assertGreaterEqual(first["updated"], began)


class FailingStepTests(RecordedProgress):
    def source(self):
        path = self.work / "sources" / "v1.mkv"
        path.parent.mkdir()
        path.touch()
        return path

    def test_a_join_that_fails_leaves_a_failed_joining_record_not_a_running_one(self):
        clip = join_sources.Clip(Path("a.mp4"), 30, False, 1.0, False, fps=(30, 1))
        with mock.patch.object(join_sources, "probe", return_value=clip), mock.patch.object(join_sources, "run_all", return_value=[1]), \
                mock.patch.object(join_sources.ffio, "user_input_args", return_value=["-i", "a.mp4"]):
            with self.assertRaises(SystemExit):
                join_sources.main("sources/v1.mkv", ["a.mp4"])
        self.assertEqual((self.records[-1]["stage"], self.records[-1]["state"]), ("joining", "failed"))

    def test_the_audio_is_written_beside_its_target_and_renamed_in_whole(self):
        source = self.source()
        outputs = []

        def encode(command, on_seconds):
            outputs.append(Path(command[-1]))
            Path(command[-1]).write_bytes(b"RIFF")

        with mock.patch.object(prepare.ffio, "probe", return_value={"durationS": 5.0}), mock.patch.object(prepare.ffio, "user_input_args", return_value=["-i", str(source)]), \
                mock.patch.object(prepare.ffio, "run_reporting", encode):
            target = prepare.build_audio(source, "v1")
        self.assertNotEqual(outputs, [target])
        self.assertEqual((target.read_bytes(), outputs[0].exists()), (b"RIFF", False))

    def test_an_audio_step_that_fails_leaves_a_failed_audio_record(self):
        source = self.source()
        with mock.patch.object(prepare.ffio, "probe", return_value={"durationS": 5.0}), mock.patch.object(prepare.ffio, "user_input_args", return_value=["-i", str(source)]), \
                mock.patch.object(prepare.ffio, "run_reporting", side_effect=subprocess.CalledProcessError(1, "ffmpeg")):
            with self.assertRaises(subprocess.CalledProcessError):
                prepare.build_audio(source, "v1")
        self.assertEqual((self.records[-1]["stage"], self.records[-1]["state"], self.records[-1]["total"]), ("audio", "failed", 5.0))

    def test_a_proxy_step_reports_its_seconds_against_the_source_length_and_never_past_it(self):
        source = self.source()

        def encode(command, on_seconds):
            on_seconds(2.0)
            on_seconds(9.0)

        with mock.patch.object(prepare.ffio, "probe", return_value={"durationS": 4.0}), mock.patch.object(prepare.ffio, "run_reporting", encode), \
                mock.patch.object(prepare.ffio, "user_input_args", return_value=["-i", str(source)]), mock.patch.object(prepare, "orientation_filter", return_value=""), \
                mock.patch.object(prepare, "assert_upright"), mock.patch.object(Path, "replace"):
            prepare.build_proxy(source, "v1", backends.active())
        proxy = self.of("proxy")
        self.assertEqual([record["done"] for record in proxy], [0, 0, 2.0, 4.0, 4.0])
        self.assertEqual((proxy[-1]["state"], proxy[-1]["total"]), ("done", 4.0))


class MachineHomeTests(unittest.TestCase):
    def test_the_parity_tests_write_their_progress_to_the_scratch_home_not_the_machine_s(self):
        with tempfile.TemporaryDirectory() as machine:
            env = {key: value for key, value in os.environ.items() if not key.startswith("ZKS_")} | {"HOME": machine, "USERPROFILE": machine}
            probe = "import parity.test_golden, os; from zks_engine import progress_store; print(progress_store.PROGRESS); print(os.environ['ZKS_HOME'])"
            result = subprocess.run([sys.executable, "-c", probe], capture_output=True, text=True, env=env, cwd=ENGINE_TESTS)
            self.assertEqual(result.returncode, 0, result.stderr)
            progress_dir, scratch_home = (Path(line) for line in result.stdout.splitlines()[-2:])
            self.assertEqual(progress_dir, scratch_home / "progress")
            self.assertFalse(progress_dir.is_relative_to(machine), progress_dir)


if __name__ == "__main__":
    unittest.main()
