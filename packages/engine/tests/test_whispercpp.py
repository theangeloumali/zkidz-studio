# Created by The Angelo Umali.
# whisper.cpp runner: pinned binary lookup, model choice, CLI args, JSON parsing and one real tiny-model run.
import json
import os
import tempfile
import unittest
import wave
from pathlib import Path
from unittest import mock

from support import ENGINE  # first: it sets a scratch ZKS_HOME

from zks_engine import home
from zks_engine.ffio import ToolMissing
from zks_engine.transcribe import whispercpp

WHISPER_FIXTURES = ENGINE / "tests" / "fixture" / "whisper"
JFK_WAV = WHISPER_FIXTURES / "jfk-3s.wav"
JFK_WORDS = [
    {"start": 100, "end": 330, "text": " And"},
    {"start": 330, "end": 680, "text": " so,"},
    {"start": 680, "end": 730, "text": " my"},
    {"start": 730, "end": 1220, "text": " fellow"},
    {"start": 1220, "end": 2000, "text": " Americans!"},
]
SHA = "a72becf15d7917f990f6313867a52638b82b7f9ef237fb0c980dac56a135781c"
FAKE_LOCK = {
    "tools": {
        "whisper-cpp": {
            "platforms": {
                "linux-x64": {"url": "https://example.invalid/w.tar.gz", "sha256": SHA, "size": 1, "executable": "bin/whisper-cli"},
                "mac-arm64": {"homebrew": "whisper-cpp", "executable": "whisper-cli"},
            }
        }
    },
    "models": {
        "tiny": {"file": "ggml-tiny.bin"},
        "base": {"file": "ggml-base.bin"},
        "large-v3-turbo-q5_0": {"file": "ggml-large-v3-turbo-q5_0.bin"},
        "large-v3-turbo": {"file": "ggml-large-v3-turbo.bin"},
    },
}


def scratch_home():
    folder = tempfile.TemporaryDirectory(prefix="zks-whisper-home-")
    patch = mock.patch.dict(os.environ, {"ZKS_HOME": folder.name})
    patch.start()
    return folder, patch


class ParseTranscriptionTests(unittest.TestCase):
    def test_recorded_run_becomes_word_lines(self):
        document = json.loads((WHISPER_FIXTURES / "jfk-3s.tiny.json").read_text(encoding="utf-8"))
        self.assertEqual(whispercpp.parse_transcription(document), JFK_WORDS)

    def test_blank_audio_marker_is_not_a_word(self):
        document = json.loads((WHISPER_FIXTURES / "silence-3s.tiny.json").read_text(encoding="utf-8"))
        self.assertEqual(whispercpp.parse_transcription(document), [])


class PlatformKeyTests(unittest.TestCase):
    def test_matches_the_tools_lock_keys(self):
        self.assertEqual(whispercpp.platform_key("linux", "x86_64"), "linux-x64")
        self.assertEqual(whispercpp.platform_key("win32", "AMD64"), "win-x64")
        self.assertEqual(whispercpp.platform_key("win32", "ARM64"), "win-arm64")
        self.assertEqual(whispercpp.platform_key("darwin", "arm64"), "mac-arm64")
        self.assertEqual(whispercpp.platform_key("linux", "aarch64"), "linux-arm64")

    def test_the_real_lock_pins_this_platform(self):
        self.assertIn(whispercpp.platform_key(), whispercpp.load_lock()["tools"]["whisper-cpp"]["platforms"])


class CliPathTests(unittest.TestCase):
    def setUp(self):
        self.home, patch = scratch_home()
        self.addCleanup(patch.stop)
        self.addCleanup(self.home.cleanup)

    def test_pinned_binary_under_the_hash_named_tools_dir(self):
        pinned = Path(self.home.name) / "tools" / "whisper-cpp" / SHA[:12] / "bin" / "whisper-cli"
        pinned.parent.mkdir(parents=True)
        pinned.touch()
        self.assertEqual(whispercpp.cli_path(FAKE_LOCK, "linux-x64"), pinned)

    def test_an_uninstalled_sha_pin_never_runs_an_unpinned_binary_from_path(self):
        with mock.patch("shutil.which", return_value="/usr/bin/whisper-cli"), self.assertRaisesRegex(ToolMissing, "pnpm zks setup"):
            whispercpp.cli_path(FAKE_LOCK, "linux-x64")

    def test_a_homebrew_pin_resolves_from_path(self):
        with mock.patch("shutil.which", return_value="/usr/bin/whisper-cli") as which:
            self.assertEqual(whispercpp.cli_path(FAKE_LOCK, "mac-arm64"), Path("/usr/bin/whisper-cli"))
        which.assert_called_with("whisper-cli")

    def test_missing_everywhere_says_to_run_setup(self):
        with mock.patch("shutil.which", return_value=None), self.assertRaisesRegex(ToolMissing, "pnpm zks setup"):
            whispercpp.cli_path(FAKE_LOCK, "linux-x64")


class ModelPathTests(unittest.TestCase):
    def setUp(self):
        self.home, patch = scratch_home()
        self.addCleanup(patch.stop)
        self.addCleanup(self.home.cleanup)
        self.models = Path(self.home.name) / "models"
        self.models.mkdir()

    def test_named_model(self):
        (self.models / "ggml-base.bin").touch()
        self.assertEqual(whispercpp.model_path("base", FAKE_LOCK), self.models / "ggml-base.bin")

    def test_default_is_the_most_accurate_installed(self):
        for name in ("ggml-tiny.bin", "ggml-base.bin"):
            (self.models / name).touch()
        self.assertEqual(whispercpp.model_path(None, FAKE_LOCK), self.models / "ggml-base.bin")
        (self.models / "ggml-large-v3-turbo-q5_0.bin").touch()
        self.assertEqual(whispercpp.model_path(None, FAKE_LOCK), self.models / "ggml-large-v3-turbo-q5_0.bin")

    def test_missing_model_says_to_run_setup(self):
        with self.assertRaisesRegex(ToolMissing, "ggml-base.bin.*pnpm zks setup"):
            whispercpp.model_path("base", FAKE_LOCK)

    def test_unknown_model_name(self):
        with self.assertRaisesRegex(ValueError, "no pinned whisper model 'huge'"):
            whispercpp.model_path("huge", FAKE_LOCK)


class CliArgsTests(unittest.TestCase):
    def test_word_level_json_run(self):
        args = whispercpp.cli_args(Path("w"), Path("m.bin"), Path("a.wav"), Path("out/words"), "tl", 3)
        self.assertEqual(
            args,
            ["w", "-m", "m.bin", "-f", "a.wav", "-l", "tl", "-t", "3", "-oj", "-of", str(Path("out/words")), "-np", "-ml", "1", "-sow"],
        )


class WriteWindowTests(unittest.TestCase):
    def test_slices_frames_and_pads_with_silence(self):
        with tempfile.TemporaryDirectory() as folder:
            window = Path(folder) / "window.wav"
            whispercpp.write_window(JFK_WAV, 1.0, 1.5, window, lead=0.5, tail=1.0)
            with wave.open(str(window)) as written, wave.open(str(JFK_WAV)) as source:
                self.assertEqual(written.getframerate(), 16000)
                self.assertEqual(written.getnframes(), 8000 + 8000 + 16000)
                frames = written.readframes(written.getnframes())
                source.setpos(16000)
                self.assertEqual(frames[:16000], bytes(16000))
                self.assertEqual(frames[16000:32000], source.readframes(8000))
                self.assertEqual(frames[32000:], bytes(32000))

    def test_window_past_the_end_is_clamped(self):
        with tempfile.TemporaryDirectory() as folder:
            window = Path(folder) / "window.wav"
            whispercpp.write_window(JFK_WAV, 2.5, 9.0, window)
            with wave.open(str(window)) as written:
                self.assertEqual(written.getnframes(), 8000)


class RealRunTests(unittest.TestCase):
    """The pinned whisper-cli and tiny model from `pnpm zks setup` (skipped when this machine has not run it)."""

    def setUp(self):
        with mock.patch.dict(os.environ):
            os.environ.pop("ZKS_HOME")
            installed_home = home.zks_home()
        patch = mock.patch.dict(os.environ, {"ZKS_HOME": str(installed_home)})
        patch.start()
        self.addCleanup(patch.stop)
        try:
            whispercpp.cli_path()
            self.model = whispercpp.model_path("tiny")
        except ToolMissing as missing:
            self.skipTest(f"needs pnpm zks setup: {missing}")

    def test_tiny_model_transcribes_the_3s_clip(self):
        words = whispercpp.transcribe_file(JFK_WAV, "en", self.model, threads=2)
        self.assertEqual([word["text"].strip(" ,.!").lower() for word in words], ["and", "so", "my", "fellow", "americans"])
        self.assertTrue(all(0 <= word["start"] <= word["end"] <= 3000 for word in words))
        self.assertEqual([word["start"] for word in words], sorted(word["start"] for word in words))


if __name__ == "__main__":
    unittest.main()
