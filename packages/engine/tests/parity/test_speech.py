# Created by The Angelo Umali.
# Plan §10.3's speech leg: public-domain LibriVox speech through the pinned whisper-cli and tiny.en on every desktop OS.
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from . import MACHINE_HOME, harness
from zks_engine import ffio
from zks_engine.transcribe import whispercpp
from zks_engine.transcribe.whispercpp import ToolMissing

SPEECH = harness.FIXTURES / "librivox-preamble.m4a"  # licence: fixtures/parity/SOURCES.md


class TinyEnTranscriptionTests(unittest.TestCase):
    def setUp(self):
        harness.skip_without_ffmpeg()
        patch = mock.patch.dict(os.environ, {"ZKS_HOME": str(MACHINE_HOME)})
        patch.start()
        self.addCleanup(patch.stop)
        try:
            whispercpp.cli_path()
            self.model = whispercpp.model_path("tiny.en")
        except ToolMissing as missing:
            if os.environ.get("ZKS_REQUIRE_GOLDEN") == "1":
                raise AssertionError(f"ZKS_REQUIRE_GOLDEN=1 but {missing}") from None
            self.skipTest(f"needs pnpm zks setup and pnpm zks models fetch tiny.en: {missing}")

    def test_tiny_en_hears_the_librivox_preamble(self):
        with tempfile.TemporaryDirectory() as folder:
            wav = Path(folder) / "speech.wav"
            harness.ffmpeg("-y", *ffio.user_input_args(SPEECH), "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav))
            words = whispercpp.transcribe_file(wav, "en", self.model, threads=2)
        heard = [word["text"].strip(" ,.!").lower() for word in words]
        # tiny.en spells the project LibraVox or LibroVox from run to run and OS to OS; the plain words are stable.
        for expected in ("this", "recording", "recordings", "public", "domain"):
            self.assertIn(expected, heard)
        self.assertEqual([word["start"] for word in words], sorted(word["start"] for word in words))


if __name__ == "__main__":
    unittest.main()
