# Created by The Angelo Umali.
# Plan §7.6: a studio job reads its specs from the snapshot taken at job start (ZKS_SPECS), never from work/ an agent may be editing.
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import pipeline, render_final
from zks_engine.qc import inputs
from zks_engine.render import cue_sheet_names

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

    def test_a_derived_file_the_snapshot_never_holds_comes_from_work(self):
        write_json(self.work / "cuts" / "v1r.json", {"source": "reel.mp4", "duration": 2.0})
        with self.in_job():
            self.assertEqual(pipeline.load_cuts("v1r")["source"], "reel.mp4")

    def test_a_cue_sheet_only_the_snapshot_holds_is_drawn(self):
        write_json(self.work / "edl" / "v1.json", {})
        write_json(self.snapshot / "cues" / "v1.json", [])
        write_json(self.work / "cues" / "v1-cc.json", [])
        with self.in_job():
            self.assertEqual(cue_sheet_names("v1", self.work), ["v1", "v1-cc"])


if __name__ == "__main__":
    unittest.main()
