# Created by The Angelo Umali.
# The doctor checks transcription the way the engine runs it: the pinned whisper-cli and a pinned model, never the ffmpeg filter.
import unittest
from pathlib import Path
from unittest import mock

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import doctor, ffio
from zks_engine.transcribe import whispercpp


class WhisperCheckTests(unittest.TestCase):
    def test_the_pinned_whisper_cli_passes(self):
        with mock.patch.object(whispercpp, "cli_path", return_value=Path("/tools/whisper-cli")):
            ready, detail = doctor.check_whisper()
        self.assertTrue(ready)
        self.assertIn("whisper-cli", detail)

    def test_a_missing_whisper_cli_fails_with_the_setup_fix(self):
        with mock.patch.object(whispercpp, "cli_path", side_effect=ffio.ToolMissing("whisper-cli is not installed. Run: pnpm zks setup")):
            ready, detail = doctor.check_whisper()
        self.assertFalse(ready)
        self.assertIn("pnpm zks setup", detail)


class ModelCheckTests(unittest.TestCase):
    def test_an_installed_pinned_model_passes(self):
        with mock.patch.object(whispercpp, "model_path", return_value=Path("/models/ggml-base.bin")):
            ready, detail = doctor.check_models()
        self.assertTrue(ready)
        self.assertIn("ggml-base.bin", detail)

    def test_no_model_fails_with_the_setup_fix(self):
        with mock.patch.object(whispercpp, "model_path", side_effect=ffio.ToolMissing("a whisper model is not in /models. Run: pnpm zks setup")):
            ready, detail = doctor.check_models()
        self.assertFalse(ready)
        self.assertIn("pnpm zks setup", detail)


class FetchTests(unittest.TestCase):
    def test_the_engine_doctor_downloads_nothing(self):
        # Unpinned resolve/main URLs bypassed tools.lock.json; pnpm zks doctor --fetch verifies each SHA-256.
        self.assertFalse(hasattr(doctor, "MODEL_URLS"))
        self.assertFalse(hasattr(doctor, "urllib"))

    def test_fetch_points_at_the_verified_installer(self):
        with self.assertRaises(SystemExit) as stopped:
            doctor.cli(["--fetch"])
        self.assertIn("pnpm zks doctor --fetch", str(stopped.exception.code))


if __name__ == "__main__":
    unittest.main()
