# Created by The Angelo Umali.
# Isolated bleep windows: each one is padded with silence and transcribed on its own through whisper.cpp.
import shutil
import tempfile
import unittest
import wave
from pathlib import Path
from unittest import mock

from support import ENGINE  # first: it sets a scratch ZKS_HOME

from zks_engine import check_windows

JFK_WAV = ENGINE / "tests" / "fixture" / "whisper" / "jfk-3s.wav"


class CheckWindowTests(unittest.TestCase):
    def setUp(self):
        self.work = Path(tempfile.mkdtemp(prefix="zks-windows-"))
        self.addCleanup(shutil.rmtree, self.work, True)
        (self.work / "audio").mkdir()
        (self.work / "transcripts").mkdir()
        shutil.copy(JFK_WAV, self.work / "audio" / "v1.wav")
        patch = mock.patch.object(check_windows, "WORK", self.work)
        patch.start()
        self.addCleanup(patch.stop)

    def test_window_words_come_back_in_source_time(self):
        seen = {}

        def fake_whisper(window_wav, language, model, threads):
            with wave.open(str(window_wav)) as window:
                seen["frames"] = window.getnframes()
            seen["language"] = language
            return [{"start": 520, "end": 900, "text": " fellow"}]

        with (
            mock.patch.object(check_windows.whispercpp, "transcribe_file", side_effect=fake_whisper),
            mock.patch.object(check_windows.whispercpp, "model_path", return_value=Path("m.bin")),
        ):
            words = check_windows.transcribe("audio/v1.wav", 0.7, 1.2, "en")
        # 0.5 s lead + 0.5 s window + 1 s tail at 16 kHz.
        self.assertEqual(seen, {"frames": 32000, "language": "en"})
        self.assertEqual(words, [{"start": 720, "end": 1100, "text": " fellow"}])
        self.assertEqual(list((self.work / "transcripts").iterdir()), [])


    def test_windows_heard_side_by_side_split_the_cores_between_them(self):
        # ep 12, a 3 s window on turbo: 46.6 s on 1 thread, 7.4 s on 12, 16.9 s on all 24. The same words each time.
        threads = []

        def fake_whisper(window_wav, language, model, thread_count):
            threads.append(thread_count)
            return []

        with (
            mock.patch.object(check_windows.whispercpp, "transcribe_file", side_effect=fake_whisper),
            mock.patch.object(check_windows.whispercpp, "model_path", return_value=Path("m.bin")),
            mock.patch.object(check_windows.whispercpp.os, "cpu_count", return_value=8),
            mock.patch.object(check_windows, "MAX_JOBS", 2),
        ):
            check_windows.transcribe_all("audio/v1.wav", [(0.7, 1.2)], "en")
            self.assertEqual(threads, [4])
            threads.clear()
            check_windows.transcribe_all("audio/v1.wav", [(0.1, 0.4), (0.7, 1.2), (1.5, 1.9)], "en")
            self.assertEqual(threads, [4, 4, 4])

if __name__ == "__main__":
    unittest.main()
