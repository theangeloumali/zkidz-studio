# Created by The Angelo Umali.
# The people gates (#44 #45): no kept second shows the whole letterboxed room (framed), and no one the creator asked to
# blur can be recognised on the master (facesBlurred).
import unittest

import numpy as np

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine.qc import people_gates

EDL = {"fps_num": 30000, "fps_den": 1001, "frames": 300, "segments": [{"in": 0, "out": 300, "target": 0}]}
RATE = 30000 / 1001


class FramedTests(unittest.TestCase):
    def test_a_stretch_with_no_window_and_no_cover_fails_with_its_time(self):
        edl = {**EDL, "reframes": [{"start": 0, "end": 150}]}
        problems = people_gates.framed_problems(edl, covers=[(150 / RATE, 200 / RATE)])
        self.assertEqual(len(problems), 1)
        self.assertIn(f"{200 / RATE:.1f}-{300 / RATE:.1f}s", problems[0])

    def test_windows_and_covers_that_meet_pass(self):
        edl = {**EDL, "reframes": [{"start": 0, "end": 150}, {"start": 200, "end": 300}]}
        self.assertEqual(people_gates.framed_problems(edl, covers=[(150 / RATE, 200 / RATE)]), [])

    def test_kept_seconds_of_a_full_frame_clip_need_no_window(self):
        # A joined source opening on a vertical clip (0-4 s of source) then the letterboxed room.
        bands = [{"at": 0, "end": 4, "band": [0, 0, 2160, 3840]}, {"at": 4, "end": 99, "band": [0, 840, 2160, 2160]}]
        spans = people_gates.full_frame_spans({**EDL, "segments": [{"in": 60, "out": 300, "target": 0}]}, bands)
        self.assertEqual([(round(a * RATE), round(b * RATE)) for a, b in spans], [(0, round(4 * RATE) - 60)])

    def test_a_gap_under_a_frame_is_rounding_not_the_room(self):
        edl = {**EDL, "reframes": [{"start": 0, "end": 149}, {"start": 150, "end": 300}]}
        self.assertEqual(people_gates.framed_problems(edl, covers=[]), [])


ME, HER = np.eye(2)


class BlurredTests(unittest.TestCase):
    IDENTITIES = {"creator": [ME.tolist()], "others": [HER.tolist()]}

    SHARP, FROSTED = 500.0, 10.0  # Laplacian at 64 px: unblurred faces 250-1900; a see-through frost 5-21

    def test_a_colleagues_face_read_on_the_master_fails_with_its_time(self):
        problems = people_gates.blurred_problems([(12.5, [(ME, self.SHARP)]), (13.0, [(HER, self.SHARP), (ME, self.SHARP)])], self.IDENTITIES)
        self.assertEqual(problems, ["a face the creator asked to blur reads at 13.0s"])

    def test_a_face_still_found_under_its_frost_fails_though_no_one_can_name_it(self):
        # Angelo read eyes and nose through a 91 % blur that QC passed; a face blurred right is no longer found at all.
        stranger = np.zeros(2)
        problems = people_gates.blurred_problems([(38.5, [(HER, self.FROSTED)]), (39.0, [(stranger, self.FROSTED)])], self.IDENTITIES)
        self.assertEqual(problems, ["a face the creator asked to blur shows through its blur at 38.5s",
                                    "a face the creator asked to blur shows through its blur at 39.0s"])

    def test_his_own_soft_face_passes(self):
        self.assertEqual(people_gates.blurred_problems([(4.0, [(ME, self.FROSTED)])], self.IDENTITIES), [])

    def test_his_face_and_faces_matching_no_one_pass(self):
        stranger = np.zeros(2)  # matches no one: a turned face, or someone never seen in the source
        self.assertEqual(people_gates.blurred_problems([(1.0, [(ME, self.SHARP)]), (2.0, [(stranger, self.SHARP)])], self.IDENTITIES), [])


if __name__ == "__main__":
    unittest.main()
