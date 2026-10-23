# Created by The Angelo Umali.
# zks-engine ingest / transcribe: the two job commands the server's engine-jobs.ts spawns, in its argv and report shapes.
import contextlib
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path
from unittest import mock

from support import ENGINE, has_ffmpeg  # first: it sets a scratch ZKS_HOME

from test_cli import run_cli
from zks_engine import cli, ffio, home, join_sources, showcase, transcribe
from zks_engine.transcribe import whispercpp

JFK_WAV = ENGINE / "tests" / "fixture" / "whisper" / "jfk-3s.wav"


def call_cli(*args):
    """cli.main in-process: (exit code, parsed stdout), with stdout captured so a stray print would break the parse."""
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = cli.main(list(args))
    return code, json.loads(out.getvalue())


def clip_of(name, frames):
    return join_sources.Clip(Path(name), frames, False, 1.0, False, fps=(30, 1))


class ScratchWork(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.work = Path(folder.name) / "work"
        self.work.mkdir()
        for module in (cli, transcribe):
            patch = mock.patch.object(module, "WORK", self.work)
            patch.start()
            self.addCleanup(patch.stop)

    def mock_prepare(self):
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        self.build_audio = stack.enter_context(mock.patch.object(cli.prepare, "build_audio"))
        self.build_proxy = stack.enter_context(mock.patch.object(cli.prepare, "build_proxy"))
        stack.enter_context(mock.patch.object(cli.backends, "active", return_value="backend"))


class IngestModeTests(unittest.TestCase):
    def assert_spec_invalid(self, *args, mentions):
        result = run_cli("ingest", "--json", *args)
        self.assertEqual(result.returncode, cli.EXIT_SPEC_INVALID, result.stderr)
        error = json.loads(result.stdout)["error"]
        self.assertEqual(error["code"], "spec_invalid")
        self.assertIn(mentions, error["message"])

    def test_single_takes_one_clip(self):
        self.assert_spec_invalid("--video", "v1", "--mode", "single", "--clip", "a.mp4", "--clip", "b.mp4", mentions="single")

    def test_showcase_needs_its_inserts(self):
        self.assert_spec_invalid("--video", "v1", "--mode", "showcase", "--clip", "a.mp4", mentions="showcase")

    def test_join_takes_no_inserts(self):
        self.assert_spec_invalid("--video", "v1", "--mode", "join", "--clip", "a.mp4", "--inserts", "i.json", mentions="join")

    def test_the_video_id_is_checked(self):
        self.assert_spec_invalid("--video", "../v1", "--mode", "single", "--clip", "a.mp4", mentions="video id")


class IngestReportTests(ScratchWork):
    def test_join_reports_frames_and_each_clip_start_then_prepares_the_source(self):
        self.mock_prepare()
        with mock.patch.object(join_sources, "main", return_value=[clip_of("a.mp4", 90), clip_of("b.mp4", 60)]) as join:
            code, report = call_cli("ingest", "--json", "--video", "v1", "--mode", "join", "--clip", "a.mp4@1.2", "--clip", "b.mp4")
        self.assertEqual(code, 0)
        self.assertEqual(report, {"sourcePath": "sources/v1.mkv", "frames": 150, "joins": [{"clip": 0, "at": 0.0}, {"clip": 1, "at": 3.0}]})
        join.assert_called_once_with("sources/v1.mkv", ["a.mp4@1.2", "b.mp4"])
        self.build_audio.assert_called_once_with(self.work / "sources" / "v1.mkv", "v1")
        self.build_proxy.assert_called_once_with(self.work / "sources" / "v1.mkv", "v1", "backend")

    def test_showcase_reads_the_servers_inserts_in_the_engines_shape(self):
        self.mock_prepare()
        server_inserts = [{"at": 1.0, "end": 2.5, "srcAssetId": "a1", "srcAt": 0.5, "panel": "landscape", "note": "demo", "srcPath": "/m/screen.mp4"}]
        inserts = self.work / "inserts.json"
        inserts.write_text(json.dumps(server_inserts), encoding="utf-8")
        with mock.patch.object(showcase, "main", return_value=clip_of("cam.mp4", 120)) as run_showcase:
            code, report = call_cli("ingest", "--json", "--video", "v1", "--mode", "showcase", "--inserts", str(inserts), "--clip", "cam.mp4")
        self.assertEqual(code, 0)
        self.assertEqual(report, {"sourcePath": "sources/v1.mkv", "frames": 120, "joins": [{"clip": 0, "at": 0.0}]})
        run_showcase.assert_called_once_with("v1", "cam.mp4", [{"at": 1.0, "end": 2.5, "src": "/m/screen.mp4", "src_at": 0.5, "panel": "landscape"}])

    def test_an_engine_exit_message_becomes_a_json_error(self):
        with mock.patch.object(join_sources, "main", side_effect=SystemExit("clips at different rates: a.mp4 25/1")):
            code, payload = call_cli("ingest", "--json", "--video", "v1", "--mode", "join", "--clip", "a.mp4", "--clip", "b.mp4")
        self.assertEqual(code, cli.EXIT_FAILED)
        self.assertEqual(payload, {"error": {"code": "engine_failed", "message": "clips at different rates: a.mp4 25/1"}})

    def test_module_progress_lines_stay_off_stdout(self):
        self.mock_prepare()

        def chatty_join(*_args):
            print("joining 1 clips")
            return [clip_of("a.mp4", 30)]

        with mock.patch.object(join_sources, "main", side_effect=chatty_join), contextlib.redirect_stderr(io.StringIO()) as stderr:
            code, report = call_cli("ingest", "--json", "--video", "v1", "--mode", "single", "--clip", "a.mp4")
        self.assertEqual((code, report["frames"]), (0, 30))
        self.assertIn("joining 1 clips", stderr.getvalue())


class TranscribeTests(ScratchWork):
    def fake_whisper(self, _chunk_wav, _language, _model, _threads):
        return [{"start": 100, "end": 400, "text": " Hello"}, {"start": 400, "end": 900, "text": " world."}]

    def ingested_audio(self):
        (self.work / "audio").mkdir()
        shutil.copy(JFK_WAV, self.work / "audio" / "v1.wav")

    def test_writes_the_servers_word_list_and_reports_it(self):
        self.ingested_audio()
        with (
            mock.patch.object(whispercpp, "transcribe_file", side_effect=self.fake_whisper),
            mock.patch.object(whispercpp, "model_path", return_value=Path("m.bin")) as model_path,
        ):
            code, report = call_cli("transcribe", "--json", "--video", "v1", "--language", "en", "--model", "base")
        self.assertEqual(code, 0)
        self.assertEqual(report, {"wordsPath": "transcripts/v1.words.json", "words": 2, "chunks": 1})
        model_path.assert_called_once_with("base")
        words = json.loads((self.work / "transcripts" / "v1.words.json").read_text(encoding="utf-8"))
        self.assertEqual(words, [{"at": 0.1, "end": 0.4, "text": "Hello"}, {"at": 0.4, "end": 0.9, "text": "world."}])

    def test_without_ingested_audio_it_says_to_ingest_first(self):
        code, payload = call_cli("transcribe", "--json", "--video", "v1", "--language", "en", "--model", "base")
        self.assertEqual(code, cli.EXIT_SPEC_INVALID)
        self.assertIn("ingest", payload["error"]["message"])

    def test_an_unknown_model_is_a_spec_error(self):
        self.ingested_audio()
        code, payload = call_cli("transcribe", "--json", "--video", "v1", "--language", "en", "--model", "enormous")
        self.assertEqual(code, cli.EXIT_SPEC_INVALID)
        self.assertIn("enormous", payload["error"]["message"])


def installed_home():
    """The machine's real ZKS_HOME (support swaps in a scratch one), when `pnpm zks setup` put whisper-cli and tiny there."""
    with mock.patch.dict(os.environ):
        os.environ.pop("ZKS_HOME")
        real_home = home.zks_home()
        os.environ["ZKS_HOME"] = str(real_home)
        try:
            whispercpp.cli_path()
            whispercpp.model_path("tiny")
        except ffio.ToolMissing:
            return None
    return real_home


@unittest.skipUnless(has_ffmpeg(), "needs ffmpeg")
class RealCliTests(unittest.TestCase):
    """The spawned CLI as the server runs it: ZKS_WORK set, report on stdout, artifacts under work/, on the backend the
    probe picks (NVIDIA on a WSL host runs CUDA, as it has no Vulkan GPU for libplacebo)."""

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.work = self.root / "work"
        (self.root / "media").mkdir()
        self.work.mkdir()
        self.env = {key: value for key, value in os.environ.items() if key != "ZKS_BACKEND"} | {"ZKS_WORK": str(self.work)}

    def clip(self, name, seconds):
        path = self.root / "media" / name
        subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-f", "lavfi", "-i", f"testsrc2=size=180x320:rate=30:duration={seconds}", "-f", "lavfi",
                        "-i", f"sine=frequency=440:duration={seconds}", "-c:v", "ffv1", "-c:a", "flac", str(path)], check=True)
        return path

    def test_ingest_joins_and_prepares_real_clips(self):
        first, second = self.clip("a.mkv", 0.5), self.clip("b.mkv", 1)
        result = run_cli("ingest", "--json", "--video", "v1", "--mode", "join", "--clip", str(first), "--clip", str(second), env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {"sourcePath": "sources/v1.mkv", "frames": 45, "joins": [{"clip": 0, "at": 0.0}, {"clip": 1, "at": 0.5}]})
        for made in ("sources/v1.mkv", "audio/v1.wav", "mezz/v1.mp4"):
            self.assertGreater((self.work / made).stat().st_size, 0, made)
        with wave.open(str(self.work / "audio" / "v1.wav")) as audio:
            self.assertEqual((audio.getframerate(), audio.getnchannels()), (16000, 1))

    @unittest.skipUnless(installed_home(), "needs pnpm zks setup (whisper-cli and the tiny model)")
    def test_transcribe_runs_whisper_on_the_ingested_audio(self):
        self.env["ZKS_HOME"] = str(installed_home())
        (self.work / "audio").mkdir()
        shutil.copy(JFK_WAV, self.work / "audio" / "v1.wav")
        result = run_cli("transcribe", "--json", "--video", "v1", "--language", "en", "--model", "tiny", env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual((report["wordsPath"], report["chunks"]), ("transcripts/v1.words.json", 1))
        words = json.loads((self.work / "transcripts" / "v1.words.json").read_text(encoding="utf-8"))
        self.assertEqual(len(words), report["words"])
        self.assertIn("americans", " ".join(word["text"] for word in words).lower())


if __name__ == "__main__":
    unittest.main()
