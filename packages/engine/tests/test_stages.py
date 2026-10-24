# Created by The Angelo Umali.
# The studio's engine steps as CLI commands: ingest, transcribe and the edit stage render-master runs first (plan §6.8, §14 Phase 5).
import json
import os
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from unittest import mock

from support import has_ffmpeg  # first: it sets a scratch ZKS_HOME

from zks_engine import cli, ffio

FPS = "30000/1001"
CLIP_FRAMES = 60
STUDIO_CUTS = {
    "schemaVersion": 1,
    "sourceAssetId": "00000000-0000-4000-8000-0000000a0002",
    "durationS": 2,
    "fps": {"num": 30000, "den": 1001},
    "removals": [{"at": 0.9, "end": 1.1, "reason": "dead air", "pin": True}],
}


def run_engine(work, *args):
    """The CLI as the server spawns it: its own process, the project's work dir in ZKS_WORK, JSON on stdout."""
    env = {**os.environ, "ZKS_WORK": str(work), "ZKS_BACKEND": "cpu", "RENDER_JOBS": "1"}
    result = subprocess.run([sys.executable, "-m", "zks_engine.cli", *args, "--json"], capture_output=True, text=True, env=env, cwd=work, timeout=600)
    return result.returncode, json.loads(result.stdout), result.stderr


def scratch_clip_project():
    """A project folder with one 2 s moving clip under media/ and an empty work/."""
    root = Path(tempfile.mkdtemp(prefix="zks-stages-"))
    (root / "media").mkdir()
    (root / "work").mkdir()
    clip = root / "media" / "clip.mp4"
    subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i", f"testsrc2=size=360x640:rate={FPS}", "-f", "lavfi", "-i",
                    "sine=frequency=330:sample_rate=48000", "-frames:v", str(CLIP_FRAMES), "-t", "2.002", "-c:v", "libx264", "-preset", "ultrafast",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", str(clip)], check=True, timeout=120)
    return root, clip


class ParserTests(unittest.TestCase):
    def test_the_studio_steps_parse_with_json_only(self):
        ingest = cli.parser().parse_args(["ingest", "--video", "v1", "--mode", "join", "--clip", "media/a.mp4", "--clip", "media/b.mp4@1.25", "--json"])
        self.assertEqual(ingest.clip, ["media/a.mp4", "media/b.mp4@1.25"])
        transcribe = cli.parser().parse_args(["transcribe", "--video", "v1", "--language", "auto", "--model", "base", "--json"])
        self.assertEqual((transcribe.language, transcribe.model), ("auto", "base"))
        edit = cli.parser().parse_args(["edit", "--video", "v1", "--source", "work/sources/v1.mkv", "--json"])
        self.assertEqual(edit.source, "work/sources/v1.mkv")
        master = cli.parser().parse_args(["render-master", "--video", "v1", "--quality", "draft", "--source", "work/sources/v1.mkv", "--json"])
        self.assertEqual(master.source, "work/sources/v1.mkv")


class TranscribeTests(unittest.TestCase):
    def test_words_come_back_in_source_seconds_as_the_studio_reads_them(self):
        work = Path(tempfile.mkdtemp(prefix="zks-words-"))

        def fake_main(wav, destination, _chunks, language, model):
            self.assertEqual((wav, language, model), ("audio/v1.wav", "auto", "base"))
            (work / destination).parent.mkdir(exist_ok=True)  # where the real transcribe.main writes its JSONL
            return [{"start": 400, "end": 800, "text": " we"}, {"start": 1200, "end": 1650, "text": " ship"}], 1

        (work / "audio").mkdir()
        with wave.open(str(work / "audio" / "v1.wav"), "wb") as silence:
            silence.setnchannels(1)
            silence.setsampwidth(2)
            silence.setframerate(16000)
            silence.writeframes(bytes(2 * 16000 * 2))
        with mock.patch.object(cli, "WORK", work), mock.patch.object(cli.transcribe, "main", fake_main), mock.patch("builtins.print") as printed:
            self.assertEqual(cli.main(["transcribe", "--video", "v1", "--language", "auto", "--model", "base", "--json"]), 0)
        report = json.loads(printed.call_args.args[0])
        self.assertEqual(report["words"], 2)
        self.assertEqual(json.loads((work / report["wordsPath"]).read_text(encoding="utf-8")),
                         [{"at": 0.4, "end": 0.8, "text": "we"}, {"at": 1.2, "end": 1.65, "text": "ship"}])

    def test_transcribing_before_ingest_is_a_spec_error(self):
        with mock.patch.object(cli, "WORK", Path(tempfile.mkdtemp())), mock.patch("builtins.print") as printed:
            self.assertEqual(cli.main(["transcribe", "--video", "v1", "--language", "auto", "--model", "base", "--json"]), cli.EXIT_SPEC_INVALID)
        self.assertIn("ingest", json.loads(printed.call_args.args[0])["error"]["message"])


@unittest.skipUnless(has_ffmpeg(), "needs ffmpeg")
class IngestAndEditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root, cls.clip = scratch_clip_project()
        cls.work = cls.root / "work"
        cls.ingest = run_engine(cls.work, "ingest", "--video", "v1", "--mode", "single", "--clip", str(cls.clip))

    def test_ingest_joins_the_clip_and_prepares_its_audio_and_proxy(self):
        code, report, stderr = self.ingest
        self.assertEqual(code, 0, stderr)
        self.assertEqual(report, {"sourcePath": "sources/v1.mkv", "frames": CLIP_FRAMES, "joins": [{"clip": 0, "at": 0}]})
        self.assertTrue((self.work / "audio" / "v1.wav").stat().st_size > 0)
        self.assertTrue((self.work / "mezz" / "v1.mp4").stat().st_size > 0)

    def test_the_edit_stage_builds_the_edl_and_the_edits_audio_from_the_studio_cut_spec(self):
        (self.work / "cuts").mkdir(exist_ok=True)
        (self.work / "cuts" / "v1.json").write_text(json.dumps(STUDIO_CUTS), encoding="utf-8")
        code, report, stderr = run_engine(self.work, "edit", "--video", "v1", "--source", str(self.work / "sources" / "v1.mkv"))
        self.assertEqual(code, 0, stderr)
        edl = json.loads((self.work / "edl" / "v1.json").read_text(encoding="utf-8"))
        self.assertEqual(report, {"frames": edl["frames"], "segments": 2, "captions": 0})
        self.assertLess(edl["frames"], CLIP_FRAMES)
        self.assertTrue((self.work / "audio" / "v1_edit.wav").exists())
        self.assertEqual(json.loads((self.work / "cuts" / "v1.json").read_text(encoding="utf-8")), STUDIO_CUTS)
        # An edit with no cues yet still draws, from a placeholder kept out of the spec folder.
        self.assertEqual(json.loads((self.work / "derived" / "cues" / "v1.json").read_text(encoding="utf-8")), [])
        self.assertFalse((self.work / "cues" / "v1.json").exists())

    def test_the_edl_stops_at_the_sources_last_frame_when_the_spec_rounds_its_length_up(self):
        (self.work / "cuts").mkdir(exist_ok=True)
        (self.work / "cuts" / "v1.json").write_text(json.dumps({**STUDIO_CUTS, "durationS": 2.5}), encoding="utf-8")
        code, _, stderr = run_engine(self.work, "edit", "--video", "v1", "--source", str(self.work / "sources" / "v1.mkv"))
        self.assertEqual(code, 0, stderr)
        edl = json.loads((self.work / "edl" / "v1.json").read_text(encoding="utf-8"))
        self.assertEqual(edl["segments"][-1]["out"], CLIP_FRAMES)

    def test_a_reel_is_cut_from_the_base_spec_and_its_keep_ranges(self):
        (self.work / "cuts").mkdir(exist_ok=True)
        (self.work / "reels").mkdir(exist_ok=True)
        (self.work / "cuts" / "v1.json").write_text(json.dumps(STUDIO_CUTS), encoding="utf-8")
        (self.work / "reels" / "v1.json").write_text(json.dumps({"schemaVersion": 1, "baseVideoId": "v1", "keep": [{"at": 0, "end": 0.8}]}), encoding="utf-8")
        code, report, stderr = run_engine(self.work, "edit", "--video", "v1r", "--source", str(self.work / "sources" / "v1.mkv"))
        self.assertEqual(code, 0, stderr)
        self.assertLess(report["frames"], 36)  # ~0.8 s kept; edl.py may snap the unpinned keep edge to a quiet frame
        self.assertTrue((self.work / "audio" / "v1r_edit.wav").exists())
        self.assertTrue((self.work / "derived" / "cuts" / "v1r.json").exists())
        self.assertFalse((self.work / "cuts" / "v1r.json").exists())

    def test_the_edit_stage_without_a_cut_spec_is_a_spec_error(self):
        empty = Path(tempfile.mkdtemp(prefix="zks-empty-", dir=self.root)) / "work"
        empty.mkdir()
        code, report, _ = run_engine(empty, "edit", "--video", "v9", "--source", str(self.work / "sources" / "v1.mkv"))
        self.assertEqual((code, report["error"]["code"]), (cli.EXIT_SPEC_INVALID, "spec_invalid"))
        self.assertIn("set_cuts", report["error"]["message"])


if __name__ == "__main__":
    unittest.main()
