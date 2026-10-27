# Created by The Angelo Umali.
# The transcribe entry point: chunks at quiet points, runs whisper.cpp per chunk, writes source-time word lines.
import json
import shutil
import tempfile
import unittest
import wave
from pathlib import Path
from unittest import mock

from support import ENGINE  # first: it sets a scratch ZKS_HOME

from zks_engine import transcribe

JFK_WAV = ENGINE / "tests" / "fixture" / "whisper" / "jfk-3s.wav"


class TranscribeMainTests(unittest.TestCase):
    def setUp(self):
        self.work = Path(tempfile.mkdtemp(prefix="zks-transcribe-"))
        self.addCleanup(shutil.rmtree, self.work, True)
        (self.work / "audio").mkdir()
        shutil.copy(JFK_WAV, self.work / "audio" / "v1.wav")
        patch = mock.patch.object(transcribe, "WORK", self.work)
        patch.start()
        self.addCleanup(patch.stop)

    def fake_whisper(self, chunk_wav, language, model, threads):
        with wave.open(str(chunk_wav)) as chunk:
            length_ms = round(chunk.getnframes() * 1000 / chunk.getframerate())
        self.calls.append((language, model, length_ms))
        # Named by length: chunks run in parallel, so call order is not chunk order.
        return [{"start": 10, "end": 20, "text": f" {length_ms}ms"}]

    def run_main(self, chunks, points, stage=None):
        self.calls = []
        with (
            mock.patch.object(transcribe.whispercpp, "transcribe_file", side_effect=self.fake_whisper),
            mock.patch.object(transcribe.whispercpp, "model_path", return_value=Path("m.bin")),
            mock.patch.object(transcribe, "split_points", return_value=points),
        ):
            transcribe.main("audio/v1.wav", "transcripts/v1_words.json", chunks, "tl", "tiny", stage=stage)
        lines = (self.work / "transcripts" / "v1_words.json").read_text(encoding="utf-8").splitlines()
        return [json.loads(line) for line in lines]

    def test_chunk_words_land_on_the_source_timeline(self):
        words = self.run_main(2, [0.0, 1.25, 3.0])
        self.assertEqual(words, [{"start": 10, "end": 20, "text": " 1250ms"}, {"start": 1260, "end": 1270, "text": " 1750ms"}])
        self.assertEqual(sorted(call[2] for call in self.calls), [1250, 1750])
        self.assertEqual({call[:2] for call in self.calls}, {("tl", Path("m.bin"))})

    def test_stage_counts_the_audio_seconds_finished(self):
        stage = mock.Mock()
        self.run_main(2, [0.0, 1.25, 3.0], stage=stage)
        stage.begin.assert_called_once_with(total=3.0, pace="transcribing m")
        first, last = sorted(call.args[0] for call in stage.update.call_args_list)
        self.assertIn(first, (1.25, 1.75))  # chunks finish in either order
        self.assertEqual(last, 3.0)

    def test_chunk_wavs_are_cleaned_up(self):
        self.run_main(2, [0.0, 1.25, 3.0])
        self.assertEqual(sorted(path.name for path in (self.work / "transcripts").iterdir()), ["v1_words.json"])


if __name__ == "__main__":
    unittest.main()
