# Created by The Angelo Umali.
# The edit stage's people step (#44 #45): the blur question is asked, the camera follows the speaker, the mask is written.
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import pipeline
from zks_engine.render import stages
from zks_engine.specs.gates import GateFailed

SEGMENTS = [{"in": 0, "out": 300, "target": 0}]
HIM, HER = 0, 1
FOUND = {
    "samples": [{"t": 1.0, "faces": [{"box": [270, 900, 60, 60], "track": HIM}, {"box": [810, 900, 60, 60], "track": HER}]}],
    "turns": [{"at": 0.0, "end": 10.0, "track": HIM, "box": [270, 900, 60, 60]}],
    "creator": [HIM],
    "identities": {"creator": [], "others": []},
}
LETTERBOX = [0, 420, 1080, 1080]


class PeopleStageTests(unittest.TestCase):
    def setUp(self):
        self.work = Path(tempfile.mkdtemp(prefix="zks-people-"))
        (self.work / "faces").mkdir()
        self.addCleanup(shutil.rmtree, self.work, True)
        for target, name, value in ((pipeline, "WORK", self.work), (stages.captions, "transcript_words", lambda video: [])):
            patch = mock.patch.object(target, name, value)
            patch.start()
            self.addCleanup(patch.stop)

    def run_stage(self, spec, learning=True, found=FOUND, band=LETTERBOX, write_mask=True):
        with mock.patch.object(stages.learning, "is_learning", return_value=learning), \
                mock.patch.object(stages.speakers, "analyse", return_value=found) as analyse, \
                mock.patch.object(stages.faces, "recorded_band", **({"side_effect": band} if callable(band) else {"return_value": band})), \
                mock.patch.object(stages.face_mask, "write") as write:
            out = stages.people_stage("v1", {"reframes": [], **spec}, SEGMENTS, 300, write_mask)
        return out, analyse, write

    def test_a_house_edit_without_follow_or_blur_is_untouched(self):
        out, analyse, _ = self.run_stage({}, learning=False)
        self.assertEqual(out, {"reframes": []})
        analyse.assert_not_called()

    def test_a_learning_edit_of_several_people_needs_the_blur_answer(self):
        with self.assertRaisesRegex(GateFailed, "ask the user whether their faces are blurred"):
            self.run_stage({})

    def test_a_learning_edit_of_him_alone_needs_no_answer(self):
        alone = {**FOUND, "samples": [{"t": 1.0, "faces": [{"box": [270, 900, 60, 60], "track": HIM}]}]}
        out, _, write = self.run_stage({}, found=alone)
        self.assertEqual(out["reframes"], [])
        write.assert_not_called()

    def test_follow_adds_the_speakers_window_after_the_manual_ones(self):
        manual = [[20.0, 30.0, 0.5, 0.5, 1]]
        out, _, _ = self.run_stage({"follow": "speaker", "blur_faces": "none", "reframes": manual})
        self.assertEqual(out["reframes"][0], manual[0])
        self.assertEqual(out["reframes"][1][:3], [0.0, 10.0, 0.2778])

    def test_follow_leaves_a_source_that_fills_9_16_alone(self):
        out, _, _ = self.run_stage({"follow": "speaker", "blur_faces": "none"}, band=[0, 0, 1080, 1920])
        self.assertEqual(out["reframes"], [])

    def test_follow_frames_the_letterboxed_clips_of_a_source_that_opens_full_frame(self):
        # A joined source: a vertical phone clip first, then the letterboxed room. Only the room's turns get a window.
        two = {**FOUND, "turns": [FOUND["turns"][0], {"at": 20.0, "end": 30.0, "track": HIM, "box": [270, 900, 60, 60]}]}
        out, _, _ = self.run_stage({"follow": "speaker", "blur_faces": "none"}, found=two,
                                   band=lambda work, video, at: [0, 0, 1080, 1920] if at < 15 else LETTERBOX)
        self.assertEqual([row[:2] for row in out["reframes"]], [[20.0, 30.0]])

    def test_a_preview_skips_the_mask(self):
        # Rewriting a 7-min mask on every render_preview held the edit's lock past the tool's timeout (Phase 6).
        out, _, write = self.run_stage({"follow": "speaker", "blur_faces": "others"}, write_mask=False)
        write.assert_not_called()
        self.assertEqual(len(out["reframes"]), 1)

    def test_blurring_others_writes_the_mask_without_the_creator(self):
        _, _, write = self.run_stage({"blur_faces": "others"})
        video, samples, creator, segments, total = write.call_args.args
        self.assertEqual((video, creator, segments, total), ("v1", {HIM}, SEGMENTS, 300))
        self.assertTrue((self.work / "faces" / "v1.people.json").is_file())


if __name__ == "__main__":
    unittest.main()
