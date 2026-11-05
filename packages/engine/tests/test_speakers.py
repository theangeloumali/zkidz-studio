# Created by The Angelo Umali.
# Who speaks when (#45) and whose face is blurred (#44): tracks, identities, turns and the follow reframes, on sample data.
import unittest

import cv2
import numpy as np

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import speakers
from zks_engine.qc import people_gates

ME, HER, HIM, TURNED = np.eye(4)  # orthogonal embeddings: three people, and him turned to a screen (unlike his front)


def face(x, motion=0.0, embedding=None, y=900, width=60):
    return {"box": [x, y, width, width], "motion": motion, "embedding": None if embedding is None else list(embedding)}


def samples(seconds, *rows):
    """One sample every 0.5 s; each row maps a time to the faces seen then."""
    return [{"t": t, "faces": [f for row in rows for f in row(t)]} for t in np.arange(0, seconds, 0.5)]


class MouthTests(unittest.TestCase):
    # A YuNet row: box, eyes, nose, right and left mouth corners, score.
    ROW = [100, 100, 80, 80, 120, 125, 160, 125, 140, 145, 120, 165, 160, 165, 0.9]

    def frame(self, shift=0, open_lips=False):
        rng = np.random.default_rng(1)
        image = np.zeros((300, 300), np.float32)
        skin = cv2.GaussianBlur(rng.uniform(60, 200, (110, 110)).astype(np.float32), (0, 0), 3)  # smooth, like a face
        image[90 + shift:200 + shift, 90 + shift:200 + shift] = skin
        if open_lips:
            image[160 + shift:172 + shift, 122 + shift:158 + shift] = 10
        return image

    def test_a_head_that_moves_reads_as_still_lips(self):
        self.assertLess(speakers.mouth_motion(self.frame(shift=3), self.frame(), self.ROW), speakers.MOTION_FLOOR / 2)

    def test_lips_that_open_read_above_the_floor(self):
        self.assertGreater(speakers.mouth_motion(self.frame(open_lips=True), self.frame(), self.ROW), speakers.MOTION_FLOOR)


class TrackTests(unittest.TestCase):
    def test_a_seated_face_and_a_walking_one_are_two_tracks(self):
        seen = samples(10, lambda t: [face(800)], lambda t: [face(100 + 20 * t)])
        speakers.link(seen)
        self.assertEqual({f["track"] for s in seen for f in s["faces"] if f["box"][0] == 800}, {0})
        self.assertEqual(len({f["track"] for s in seen for f in s["faces"]}), 2)

    def test_a_face_back_after_a_long_absence_elsewhere_is_a_new_track(self):
        seen = samples(10, lambda t: [face(100)] if t < 3 else [face(700)] if t > 8 else [])
        speakers.link(seen)
        self.assertEqual(len({f["track"] for s in seen for f in s["faces"]}), 2)


class IdentityTests(unittest.TestCase):
    def test_the_creator_is_the_person_most_often_alone_on_screen(self):
        # Three colleagues always share the frame, so together they outnumber him; alone, only he appears.
        census = [{"faces": 1, "embeddings": [ME]}] * 12 + [{"faces": 3, "embeddings": [HER, HIM, HER]}] * 20
        self.assertGreater(float(speakers.creator_identity(census) @ ME), 0.99)

    def test_without_enough_solo_frames_the_most_seen_person_is_the_creator(self):
        census = [{"faces": 2, "embeddings": [ME, HER]}] * 5 + [{"faces": 1, "embeddings": [HER]}] * 2 + [{"faces": 2, "embeddings": [HER, HIM]}] * 4
        self.assertGreater(float(speakers.creator_identity(census) @ HER), 0.99)

    def test_every_track_matching_him_is_his(self):
        seen = samples(10, lambda t: [face(100, embedding=ME)] if t < 4 else [face(600, embedding=ME)] if t > 6 else [],
                       lambda t: [face(900, embedding=HER)])
        speakers.link(seen)
        self.assertEqual(speakers.creator_tracks(seen, ME), {0, 2})  # tracks number in order of first sight: 0 him, 1 her, 2 him

    def test_a_profile_track_alone_is_him_and_one_beside_him_is_someone_else(self):
        # Turned to the screen he matches no one; a stranger's turned face sits beside his clear one.
        alone = samples(4, lambda t: [face(300, embedding=ME)] if t < 2 else [face(300 + 400, embedding=None)])
        speakers.link(alone)
        self.assertEqual(speakers.creator_tracks(alone, ME), {0, 1})
        beside = samples(4, lambda t: [face(300, embedding=ME), face(900, embedding=None)])
        speakers.link(beside)
        self.assertEqual(speakers.creator_tracks(beside, ME), {0})

    def test_a_profile_track_alone_long_after_he_left_is_someone_else(self):
        # OnePuhunan 31:18: he talks from behind the camera for minutes while a colleague sits in profile, never embedded.
        later = samples(40, lambda t: [face(300, embedding=ME)] if t < 2 else [], lambda t: [face(900, embedding=None)] if t > 30 else [])
        speakers.link(later)
        self.assertEqual(speakers.creator_tracks(later, ME), {0})

    def test_a_track_of_him_turned_away_is_his_when_he_turned_that_way_in_a_track_of_his(self):
        # The reel's 6% beat: he turns to the screen mid-track, later a whole track of him turned matches his front at 0.27.
        turns = lambda t: [face(300, embedding=ME if t < 2 else TURNED)] if t < 3 else []  # noqa: E731
        later = lambda t: [face(900, embedding=TURNED)] if t > 5 else []  # noqa: E731
        colleague = lambda t: [face(1500, embedding=HER)] if t > 5 else []  # noqa: E731
        seen = samples(8, turns, later, colleague)
        speakers.link(seen)
        self.assertEqual(speakers.creator_tracks(seen, ME), {0, 1})
        beside = samples(8, lambda t: [face(300, embedding=ME if t < 6 else TURNED)], lambda t: [face(900, embedding=TURNED)] if t > 5 else [])
        speakers.link(beside)
        self.assertEqual(speakers.creator_tracks(beside, ME), {0})  # a turned face on screen with him is someone else

    def test_the_identities_hold_every_view_of_him_so_the_gate_knows_him_turned(self):
        seen = samples(8, lambda t: [face(300, embedding=ME if t < 2 else TURNED)] if t < 3 else [],
                       lambda t: [face(900, embedding=TURNED)] if t > 5 else [], lambda t: [face(1500, embedding=HER)] if t > 5 else [])
        speakers.link(seen)
        found = speakers.identities(seen, ME, speakers.creator_tracks(seen, ME))
        self.assertEqual(people_gates.blurred_problems([(1.0, [(TURNED, 500.0)])], found), [])
        self.assertEqual(len(people_gates.blurred_problems([(1.0, [(HER, 500.0)])], found)), 1)


class TurnTests(unittest.TestCase):
    WORDS = [{"at": 0.2, "end": 3.8, "text": "a"}, {"at": 4.6, "end": 7.8, "text": "b"}, {"at": 8.2, "end": 8.6, "text": "c"}]

    def test_each_utterance_goes_to_the_moving_mouth(self):
        seen = samples(9, lambda t: [face(100, motion=0.6 if t < 4 else 0.1)], lambda t: [face(800, motion=0.1 if t < 4 else 0.6)])
        speakers.link(seen)
        turns = speakers.turns(self.WORDS, seen, creator={0})
        self.assertEqual([(turn["track"], turn["at"], turn["end"]) for turn in turns], [(0, 0.2, 4.6), (1, 4.6, 8.6)])

    def test_no_mouth_moving_keeps_the_last_speaker(self):
        seen = samples(9, lambda t: [face(100, motion=0.6 if t < 4 else 0.0)], lambda t: [face(800, motion=0.0)])
        speakers.link(seen)
        self.assertEqual([turn["track"] for turn in speakers.turns(self.WORDS, seen, creator={1})], [0])

    def test_with_no_one_before_a_still_mouth_frames_the_creator(self):
        # Typing with his head down, his mouth reads as still: the opening still frames him, not the listener.
        seen = samples(9, lambda t: [face(100, motion=0.0)], lambda t: [face(800, motion=0.0 if t < 4 else 0.6)])
        speakers.link(seen)
        self.assertEqual([(turn["track"], turn["at"]) for turn in speakers.turns(self.WORDS, seen, creator={0})], [(0, 0.2), (1, 4.6)])

    def test_a_long_utterance_switches_inside_it_when_the_mouth_does(self):
        # Fast Taglish back-and-forth reads as one utterance; the camera still follows each speaker.
        words = [{"at": 0.0, "end": 9.0, "text": "long"}]
        seen = samples(9, lambda t: [face(100, motion=0.6 if t < 4.5 else 0.1)], lambda t: [face(800, motion=0.1 if t < 4.5 else 3.0)])
        speakers.link(seen)
        self.assertEqual([turn["track"] for turn in speakers.turns(words, seen, creator={0})], [0, 1])

    def test_a_listener_a_little_busier_than_the_speaker_does_not_take_the_camera(self):
        words = [{"at": 0.0, "end": 3.0, "text": "a"}, {"at": 4.0, "end": 7.0, "text": "b"}]
        seen = samples(8, lambda t: [face(100, motion=0.5)], lambda t: [face(800, motion=0.1 if t < 3.5 else 0.55)])
        speakers.link(seen)
        self.assertEqual([turn["track"] for turn in speakers.turns(words, seen, creator={0})], [0])

    def test_an_utterance_with_no_face_is_never_given_to_the_next_speaker(self):
        seen = samples(9, lambda t: [face(800, motion=0.6)] if t >= 4.5 else [])
        speakers.link(seen)
        self.assertEqual([(turn["track"], turn["at"]) for turn in speakers.turns(self.WORDS, seen, creator=set())], [(0, 4.6)])


class CacheTests(unittest.TestCase):
    def test_each_finished_pass_is_saved_so_an_interrupted_scan_keeps_it(self):
        import json, shutil, tempfile
        from pathlib import Path
        from unittest import mock
        work = Path(tempfile.mkdtemp(prefix="zks-speakers-"))
        self.addCleanup(shutil.rmtree, work, True)
        (work / "mezz").mkdir()
        (work / "mezz" / "v1.mp4").write_bytes(b"proxy")
        scans = iter([[{"t": 0.0, "faces": []}], RuntimeError("stopped")])

        def scan(*_):
            result = next(scans)
            if isinstance(result, Exception):
                raise result
            return result

        with mock.patch.object(speakers.pipeline, "WORK", work), mock.patch.object(speakers, "census", return_value=[]), \
                mock.patch.object(speakers, "scan", side_effect=scan), self.assertRaises(RuntimeError):
            speakers.analyse("v1", [[0, 70]], [])
        cache = json.loads((work / "faces" / "v1.speakers.json").read_text(encoding="utf-8"))
        self.assertEqual((cache["census"], sorted(cache["chunks"])), ([], ["0"]))

    def test_a_quick_scan_writes_its_cache_once_not_per_pass(self):
        import shutil, tempfile
        from pathlib import Path
        from unittest import mock
        work = Path(tempfile.mkdtemp(prefix="zks-speakers-"))
        self.addCleanup(shutil.rmtree, work, True)
        (work / "mezz").mkdir()
        (work / "mezz" / "v1.mp4").write_bytes(b"proxy")
        writes = []
        real_write = Path.write_text
        with mock.patch.object(speakers.pipeline, "WORK", work), mock.patch.object(speakers, "census", return_value=[]), \
                mock.patch.object(speakers, "scan", return_value=[]), \
                mock.patch.object(Path, "write_text", lambda path, *a, **k: writes.append(path.name) or real_write(path, *a, **k)):
            speakers.analyse("v1", [[0, 100]], [])
        self.assertEqual([name for name in writes if name == "v1.speakers.json"], ["v1.speakers.json"])  # census + 4 chunks


class FollowTests(unittest.TestCase):
    BAND = [0, 420, 1080, 1080]  # a square picture letterboxed on the 1080 grid

    def test_turns_become_reframes_on_the_speakers_face_and_manual_windows_win(self):
        turns = [{"at": 0.0, "end": 5.0, "track": 0, "box": [270, 900, 60, 60]}, {"at": 5.0, "end": 9.0, "track": 1, "box": [810, 900, 60, 60]}]
        rows = speakers.follow_reframes(turns, lambda at: self.BAND, manual=[[6.0, 7.0, 0.5, 0.5, 1]])
        self.assertEqual([row[:2] for row in rows], [[0.0, 5.0], [5.0, 6.0], [7.0, 9.0]])
        self.assertAlmostEqual(rows[0][2], 0.278, places=3)  # the face centre's share of the band width
        self.assertAlmostEqual(rows[1][2], 0.778, places=3)
        self.assertEqual(rows[0][4], speakers.FOLLOW_SCALE)


if __name__ == "__main__":
    unittest.main()
