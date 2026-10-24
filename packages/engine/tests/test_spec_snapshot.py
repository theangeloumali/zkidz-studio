# Created by The Angelo Umali.
# Plan §7.6: a studio job reads its specs from the snapshot taken at job start (ZKS_SPECS), never from work/ an agent may be editing.
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import cli, pipeline, render_final
from zks_engine.qc import inputs
from zks_engine.render import commands, cue_sheet_names
from zks_engine.specs.gates import GateFailed

SNAPSHOT_CUTS = {"source": "snapshot.mp4", "duration": 4.0}
EDITED_CUTS = {"source": "edited-mid-render.mp4", "duration": 9.0}


def write_json(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(content), encoding="utf-8")


class SpecSnapshotTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.work = Path(folder.name) / "work"
        self.snapshot = self.work / "snapshots" / "abc"
        write_json(self.work / "cuts" / "v1.json", EDITED_CUTS)
        write_json(self.snapshot / "cuts" / "v1.json", SNAPSHOT_CUTS)
        for patcher in (mock.patch.object(pipeline, "WORK", self.work), mock.patch.object(inputs, "WORK", self.work),
                        mock.patch.object(render_final, "WORK", self.work)):
            patcher.start()
            self.addCleanup(patcher.stop)

    def in_job(self):
        return mock.patch.dict(os.environ, {"ZKS_SPECS": str(self.snapshot)})

    def test_a_job_reads_the_snapshot_cut_spec_not_the_one_edited_mid_render(self):
        with self.in_job():
            self.assertEqual(pipeline.load_cuts("v1"), SNAPSHOT_CUTS)
            self.assertEqual(inputs.cut_spec_of("v1"), SNAPSHOT_CUTS)
            self.assertEqual(render_final.spec_files("v1"), [self.snapshot / "cuts" / "v1.json"])

    def test_outside_a_job_the_engine_reads_work(self):
        with mock.patch.dict(os.environ):
            os.environ.pop("ZKS_SPECS", None)
            self.assertEqual(pipeline.load_cuts("v1"), EDITED_CUTS)

    def test_a_derived_file_the_snapshot_never_holds_comes_from_the_engines_own_folder(self):
        write_json(self.work / "derived" / "cuts" / "v1r.json", {"source": "reel.mp4", "duration": 2.0})
        with self.in_job():
            self.assertEqual(pipeline.load_cuts("v1r")["source"], "reel.mp4")

    def test_a_cue_sheet_only_the_snapshot_holds_is_drawn(self):
        write_json(self.work / "edl" / "v1.json", {})
        write_json(self.snapshot / "cues" / "v1.json", [])
        write_json(self.work / "derived" / "cues" / "v1-cc.json", [])
        with self.in_job():
            self.assertEqual(cue_sheet_names("v1", self.work), ["v1", "v1-cc"])

    # Kai snapshot_fallback.py: a spec the snapshot lacks was read live from work/, where the agent writes after the render.
    def test_a_spec_missing_from_the_snapshot_reads_as_missing_not_live(self):
        write_json(self.work / "edl" / "v1.json", {})
        write_json(self.work / "cues" / "v1.json", [{"kind": "keyword", "at": 1, "end": 2, "text": "added after"}])
        write_json(self.work / "cuts" / "v2.json", EDITED_CUTS)
        write_json(self.work / "captions" / "v1.json", [])
        with self.in_job():
            self.assertFalse(pipeline.spec_file(self.work, "cues/v1.json").exists())
            self.assertFalse(pipeline.spec_file(self.work, "captions/v1.json").exists())
            self.assertEqual(cue_sheet_names("v1", self.work), [])
            self.assertIsNone(inputs.cut_spec_of("v2"))
            self.assertEqual(inputs.caption_cues("v1"), [])

    def test_a_reel_cut_planted_in_the_live_spec_folder_is_never_read_in_a_job(self):
        write_json(self.work / "cuts" / "v1r.json", {"source": "planted.mp4", "duration": 2.0})
        with self.in_job(), self.assertRaises(FileNotFoundError):
            pipeline.load_cuts("v1r")

    def test_the_caption_gate_reads_the_derived_caption_sheet(self):
        write_json(self.work / "edl" / "v1.json", {})
        write_json(self.snapshot / "cues" / "v1.json", [{"kind": "keyword", "at": 1, "end": 2, "text": "x"}])
        write_json(self.work / "derived" / "cues" / "v1-cc.json", [{"kind": "caption", "at": 1, "end": 2, "text": "hi"}])
        with self.in_job():
            self.assertEqual([cue["text"] for cue in inputs.caption_cues("v1")], ["hi"])


class SnapshotInputTests(unittest.TestCase):
    """make-covers' cover sheet and post caption come from the job's snapshot, not the live files the server wrote."""

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.work = Path(folder.name) / "work"
        self.snapshot = self.work / "snapshots" / "abc"
        write_json(self.work / "cues_cover" / "v1.json", [{"kind": "hookTitle", "at": 0, "end": 1, "lines": ["live"]}])
        (self.work / "post").mkdir()
        (self.work / "post" / "v1.txt").write_text("live caption", encoding="utf-8")
        patcher = mock.patch.object(pipeline, "WORK", self.work)
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_covers(self):
        made = [{"path": "covers/v1-cover-a.png", "at": 2.3, "blurBoxes": 0}]
        args = cli.parser().parse_args(["make-covers", "--video", "v1", "--at", "2.3", "--cover-sheet", str(self.work / "cues_cover" / "v1.json"),
                                        "--post-caption", str(self.work / "post" / "v1.txt"), "--json"])
        with mock.patch("zks_engine.covers.make_covers", return_value=made) as make, \
                mock.patch("zks_engine.covers.write_post_caption", return_value="covers/v1-caption.txt") as write, \
                mock.patch.dict(os.environ, {"ZKS_SPECS": str(self.snapshot)}):
            commands.make_covers_payload(args)
        return make.call_args.args[2], write.call_args.args[1]

    def test_the_cover_sheet_and_post_caption_are_read_from_the_snapshot(self):
        write_json(self.snapshot / "cues_cover" / "v1.json", [])
        (self.snapshot / "post").mkdir()
        (self.snapshot / "post" / "v1.txt").write_text("snapshot caption", encoding="utf-8")
        self.assertEqual(self.run_covers(), (self.snapshot / "cues_cover" / "v1.json", self.snapshot / "post" / "v1.txt"))

    def test_a_cover_input_the_snapshot_lacks_fails_instead_of_reading_live(self):
        with self.assertRaisesRegex(GateFailed, "snapshot"):
            self.run_covers()


if __name__ == "__main__":
    unittest.main()
