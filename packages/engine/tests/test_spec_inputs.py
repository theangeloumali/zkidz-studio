# Created by The Angelo Umali.
# Every path a spec or engine command names stays inside the project (plan §6.8, §7.6): its media/, its work dir,
# or a single file registered for use in place. Each escape fails with SpecError before ffmpeg or ffprobe runs.
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import insert_audio, join_sources, pipeline, showcase, sync_inserts
from zks_engine.specs import SpecError


def scratch_dir(test):
    folder = tempfile.TemporaryDirectory()
    test.addCleanup(folder.cleanup)
    return Path(folder.name).resolve()


class ProjectInputTests(unittest.TestCase):
    def setUp(self):
        self.root = scratch_dir(self)
        self.work = self.root / "work"
        for sub in ("cuts", "edl", "inserts", "sources"):
            (self.work / sub).mkdir(parents=True)
        (self.root / "media").mkdir()
        self.clip = self.root / "media" / "clip.mp4"
        self.clip.write_bytes(b"clip")
        self.outside = scratch_dir(self) / "secret.mp4"
        self.outside.write_bytes(b"secret")
        for target in (pipeline, insert_audio, join_sources, showcase, sync_inserts):
            patcher = mock.patch.object(target, "WORK", self.work)
            patcher.start()
            self.addCleanup(patcher.stop)
        environment = mock.patch.dict(os.environ)
        environment.start()
        self.addCleanup(environment.stop)
        os.environ.pop("ZKS_INPLACE", None)

    def escape(self):
        """The outside file as a ../ path from the project dir."""
        return os.path.relpath(self.outside, self.root)

    def test_media_and_work_dir_sources_resolve(self):
        joined = self.work / "sources" / "v1.mkv"
        joined.write_bytes(b"joined")
        self.assertEqual(pipeline.source_path({"source": "media/clip.mp4"}), self.clip)
        self.assertEqual(pipeline.source_path({"source": "work/sources/v1.mkv"}), joined)

    def test_a_parent_traversal_source_fails(self):
        with self.assertRaisesRegex(SpecError, "outside the project"):
            pipeline.source_path({"source": self.escape()})

    def test_an_absolute_source_outside_the_project_fails(self):
        with self.assertRaisesRegex(SpecError, "outside the project"):
            pipeline.source_path({"source": str(self.outside)})

    def test_a_symlink_escape_fails(self):
        link = self.root / "media" / "link.mp4"
        try:
            link.symlink_to(self.outside)
        except OSError:
            self.skipTest("this filesystem cannot create symlinks")
        with self.assertRaisesRegex(SpecError, "outside the project"):
            pipeline.source_path({"source": "media/link.mp4"})

    def test_a_registered_in_place_file_resolves(self):
        os.environ["ZKS_INPLACE"] = str(self.outside)
        self.assertEqual(pipeline.source_path({"source": str(self.outside)}), self.outside)

    def test_a_video_id_cannot_leave_its_spec_folder(self):
        for load in (pipeline.load_cuts, pipeline.load_edl):
            with self.assertRaisesRegex(SpecError, "video id"):
                load("../../secret")

    def test_a_cut_specs_base_is_a_video_id(self):
        (self.work / "cuts" / "v1r.json").write_text(json.dumps({"base": "../v1"}), encoding="utf-8")
        with self.assertRaisesRegex(SpecError, "video id"):
            pipeline.load_cuts("v1r")

    def test_a_showcase_insert_outside_the_project_never_reaches_ffprobe(self):
        insert = {"at": 0.0, "end": 1.0, "src": self.escape(), "src_at": 0.0}
        with mock.patch.object(showcase, "probe_video") as probe, self.assertRaisesRegex(SpecError, "outside the project"):
            showcase.insert_command(insert, 0, 30, self.work / "out.mp4", None, (30000, 1001))
        probe.assert_not_called()

    def test_an_insert_audio_src_outside_the_project_never_reaches_ffmpeg(self):
        inserts = [{"at": 0.0, "end": 2.0, "src": str(self.outside), "src_at": 0.0, "clean": [[0.0, 1.0]]}]
        (self.work / "inserts" / "v1.json").write_text(json.dumps(inserts), encoding="utf-8")
        with mock.patch.object(insert_audio.subprocess, "run") as run, self.assertRaisesRegex(SpecError, "outside the project"):
            insert_audio.main("v1")
        run.assert_not_called()

    def test_a_joined_clip_outside_the_project_never_reaches_ffprobe(self):
        with mock.patch.object(join_sources.subprocess, "run") as run, self.assertRaisesRegex(SpecError, "outside the project"):
            join_sources.probe(f"{self.outside}@1.2")
        run.assert_not_called()

    def test_a_join_target_must_stay_in_the_work_dir(self):
        with mock.patch.object(join_sources, "probe") as probe, self.assertRaisesRegex(SpecError, "outside the project"):
            join_sources.main("../escaped.mkv", ["media/clip.mp4"])
        probe.assert_not_called()

    def test_sync_inserts_refuses_an_outside_file_and_a_bad_video_id(self):
        with mock.patch.object(sync_inserts.subprocess, "run") as run:
            with self.assertRaisesRegex(SpecError, "outside the project"):
                sync_inserts.main(["v1", str(self.clip), str(self.outside)])
            with self.assertRaisesRegex(SpecError, "video id"):
                sync_inserts.main(["../v1", str(self.clip), str(self.clip)])
        run.assert_not_called()

    def test_sync_inserts_drafts_project_relative_srcs(self):
        self.assertEqual(sync_inserts.repo_relative(self.clip), "media/clip.mp4")


class RegistryTests(unittest.TestCase):
    def test_in_place_files_come_from_the_path_list(self):
        with mock.patch.dict(os.environ, {"ZKS_INPLACE": os.pathsep.join(["/a/one.mp4", "", "/b/two.mov"])}):
            self.assertEqual(pipeline.registered_inputs(), ["/a/one.mp4", "/b/two.mov"])


if __name__ == "__main__":
    unittest.main()
