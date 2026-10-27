# Created by The Angelo Umali.
# Run from the repo root: uv run --project packages/engine python -m unittest discover -s examples/demo
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("ZKS_HOME", tempfile.mkdtemp(prefix="zks-demo-home-"))
os.environ["ZKS_TOASTS"] = "0"

import make_demo  # noqa: E402
from zks_engine import ffio  # noqa: E402
from zks_engine.pipeline import HF_DIR  # noqa: E402


def renderer_ready():
    return bool(shutil.which(ffio.ffmpeg_bin()) and shutil.which("node") and (HF_DIR / "node_modules" / "hyperframes").exists())


class DemoSpecTest(unittest.TestCase):
    def test_the_engine_cut_spec_names_the_generated_clip(self):
        engine_cuts = make_demo.engine_cuts()

        self.assertEqual(engine_cuts["source"], f"media/{make_demo.CLIP_NAME}")
        self.assertEqual(engine_cuts["duration"], make_demo.CLIP_SECONDS)

    def test_the_removal_sits_inside_the_silent_gap(self):
        gap_start, gap_end = make_demo.SILENT_GAP
        for start, end, *_ in make_demo.engine_cuts()["remove"]:
            self.assertGreaterEqual(start, gap_start)
            self.assertLessEqual(end, gap_end)

    def test_every_cue_lies_inside_the_clip(self):
        for cue in make_demo.load_cues():
            self.assertLessEqual(cue["end"], make_demo.CLIP_SECONDS)

    def test_refuses_a_project_folder_that_holds_other_files(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / "notes.txt").write_text("mine", encoding="utf-8")
            with self.assertRaises(make_demo.DemoError):
                make_demo.prepare_project(Path(folder))


@unittest.skipUnless(renderer_ready(), "needs ffmpeg (ZKS_FFMPEG), node and the overlay renderer's packages (pnpm install)")
class DemoRenderTest(unittest.TestCase):
    def test_renders_a_master_with_the_removal_cut_out(self):
        with tempfile.TemporaryDirectory() as folder:
            master = make_demo.build(Path(folder) / "demo")

            probe = subprocess.run([ffio.ffprobe_bin(), "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries",
                                    "stream=width,height,nb_read_frames", "-of", "json", str(master)], capture_output=True, text=True, check=True)
            stream = json.loads(probe.stdout)["streams"][0]
            gap_start, gap_end = make_demo.SILENT_GAP
            kept_seconds = make_demo.CLIP_SECONDS - (gap_end - gap_start)
            self.assertEqual((stream["width"], stream["height"]), (1080, 1920))
            self.assertAlmostEqual(int(stream["nb_read_frames"]) * 1001 / 30000, kept_seconds, delta=0.3)


if __name__ == "__main__":
    unittest.main()
