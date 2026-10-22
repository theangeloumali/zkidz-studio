# Created by The Angelo Umali.
# sync_inserts: where a screen recording or film plays inside the camera's footage, from sound or from on-screen motion.
import unittest
from unittest import mock

import numpy as np

from support import ENGINE  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import sync_inserts

RATE = 1000  # samples per second for the synthetic signals
EDGE = sync_inserts.AUDIO.hop  # window centres sit on the hop grid, so an edge is good to one hop


def room_with_film(film, plays, length, noise=0.3, seed=1):
    """A noisy room track with `film` audible at each (room start, film start, seconds) in `plays`."""
    rng = np.random.default_rng(seed)
    room = rng.normal(0, noise, int(length * RATE))
    for room_at, film_at, seconds in plays:
        a, f, n = int(room_at * RATE), int(film_at * RATE), int(seconds * RATE)
        room[a:a + n] += film[f:f + n]
    return room


class AudioSpanTests(unittest.TestCase):
    def setUp(self):
        self.film = np.random.default_rng(7).normal(0, 1, 30 * RATE)

    def spans(self, room):
        matches = sync_inserts.window_matches(room, self.film, RATE, sync_inserts.AUDIO.window, sync_inserts.AUDIO.hop)
        return sync_inserts.play_spans(matches, sync_inserts.AUDIO)

    def test_a_pause_splits_the_play_into_two_spans_whose_offsets_differ_by_the_pause(self):
        # Plays film 0-6 s at room 20 s, pauses 4.4 s, resumes film 6-20 s at room 30.4 s.
        spans = self.spans(room_with_film(self.film, [(20.0, 0.0, 6.0), (30.4, 6.0, 14.0)], 60))
        self.assertEqual(len(spans), 2)
        self.assertAlmostEqual(spans[0]["offset"], -20.0, delta=0.01)
        self.assertAlmostEqual(spans[1]["offset"], -24.4, delta=0.01)
        self.assertAlmostEqual(spans[0]["offset"] - spans[1]["offset"], 4.4, delta=0.01)
        self.assertEqual(spans[0]["start"], 20.0)  # began with the file: snapped to its first frame
        self.assertLess(abs(spans[0]["end"] - 26.0), EDGE)
        self.assertLess(abs(spans[1]["start"] - 30.4), EDGE)
        self.assertLess(abs(spans[1]["end"] - 44.4), EDGE)

    def test_a_play_from_mid_file_keeps_its_own_start(self):
        spans = self.spans(room_with_film(self.film, [(20.0, 1.2, 10.0)], 40))
        self.assertEqual(len(spans), 1)
        self.assertLess(abs(spans[0]["start"] - 20.0), EDGE)

    def test_a_play_to_the_files_end_and_from_the_cameras_start_reaches_both_edges(self):
        room = room_with_film(self.film, [(0.0, 20.0, 10.0)], 30)
        matches = sync_inserts.window_matches(room, self.film, RATE, sync_inserts.AUDIO.window, sync_inserts.AUDIO.hop)
        span = sync_inserts.play_spans(matches, sync_inserts.AUDIO, camera_seconds=30, film_seconds=30)[0]
        self.assertEqual((span["start"], span["end"]), (0.0, 10.0))

    def test_a_room_that_never_plays_the_film_has_no_spans(self):
        self.assertEqual(self.spans(np.random.default_rng(3).normal(0, 1, 40 * RATE)), [])


class VisualVoteTests(unittest.TestCase):
    def test_a_silent_screen_recording_wins_the_offset_vote_by_a_wide_margin(self):
        # Activity series (one value per frame): the recording's bursts show up in the camera's view, offset by 12 s.
        recording = np.abs(np.random.default_rng(5).normal(0, 1, 60 * RATE))
        camera = np.abs(np.random.default_rng(6).normal(0, 0.4, 90 * RATE))
        camera[12 * RATE:72 * RATE] += recording
        matches = sync_inserts.window_matches(camera, recording, RATE, sync_inserts.VISUAL.window, sync_inserts.VISUAL.hop)
        votes = sync_inserts.vote_offsets(matches, sync_inserts.VISUAL)
        self.assertAlmostEqual(votes[0]["offset"], -12.0, delta=0.01)
        self.assertTrue(sync_inserts.confident(votes))
        self.assertLess(abs(votes[0]["start"] - 12.0), 1.0)
        self.assertLess(abs(votes[0]["end"] - 72.0), 1.0)

    def test_two_comparable_candidates_are_not_confident(self):
        votes = [{"weight": 9.8, "windows": 10}, {"weight": 9.2, "windows": 10}]
        self.assertFalse(sync_inserts.confident(votes))

    def test_a_near_offset_competes_instead_of_vanishing(self):
        votes = sync_inserts.vote_offsets([(0, 5.0, 0.9), (1, 5.0, 0.9), (2, 5.5, 0.9), (3, 5.5, 0.85)], sync_inserts.VISUAL)
        self.assertEqual([vote["offset"] for vote in votes], [5.0, 5.5])
        self.assertFalse(sync_inserts.confident(votes))

    def test_a_lone_window_is_never_confident(self):
        self.assertFalse(sync_inserts.confident(sync_inserts.vote_offsets([(10.0, -3.0, 0.31)], sync_inserts.VISUAL)))


class CropTests(unittest.TestCase):
    def test_an_upright_clip_crops_on_the_1080_grid(self):
        self.assertEqual(sync_inserts.nvdec_crop("0:400:1080:1000", (2160, 3840), 0), "800x1040x0x0")

    def test_a_clip_stored_sideways_crops_its_coded_frame(self):
        # Coded 3840x2160, turned clockwise to stand upright (rotation 270), like the eps 04-14 raws.
        self.assertEqual(sync_inserts.nvdec_crop("100:300:800:500", (3840, 2160), 270), "360x200x600x2240")
        self.assertEqual(sync_inserts.nvdec_crop("100:300:800:500", (3840, 2160), 90), "200x360x2240x600")


class RoutingTests(unittest.TestCase):
    def test_a_file_without_an_audio_stream_is_matched_on_screen(self):
        recording = np.abs(np.random.default_rng(5).normal(0, 1, 60 * 30))
        camera = np.abs(np.random.default_rng(6).normal(0, 0.4, 90 * 30))
        camera[12 * 30:72 * 30] += recording
        with (mock.patch.object(sync_inserts, "has_audio", return_value=False),
              mock.patch.object(sync_inserts, "activity", return_value=recording),
              mock.patch.object(sync_inserts, "FRAME_RATE", 30.0)):
            mode, spans = sync_inserts.match_file(lambda: None, lambda: camera, "take.webm", visual=False)
        self.assertEqual(mode.name, "visual")
        self.assertAlmostEqual(spans[0]["offset"], -12.0, delta=0.04)


class OverlapTests(unittest.TestCase):
    def test_the_stronger_of_two_overlapping_plays_is_kept_and_names_the_other(self):
        inserts = [{"at": 10.0, "end": 20.0, "src": "a.mp4", "score": 0.5, "note": "a"},
                   {"at": 12.0, "end": 22.0, "src": "b.mp4", "score": 0.6, "note": "b"},
                   {"at": 30.0, "end": 40.0, "src": "a.mp4", "score": 0.4, "note": "c"}]
        kept = sync_inserts.drop_overlaps(inserts)
        self.assertEqual([insert["src"] for insert in kept], ["b.mp4", "a.mp4"])
        self.assertIn("also matches a.mp4", kept[0]["note"])


class DraftTests(unittest.TestCase):
    def test_a_span_becomes_an_insert_whose_file_time_follows_the_offset(self):
        span = {"start": 158.0, "end": 180.6, "offset": -150.23, "score": 0.52}
        insert = sync_inserts.draft_insert(span, "films/a.mp4", (1920, 1080), "audio")
        self.assertEqual((insert["at"], insert["end"], insert["src_at"]), (158.0, 180.6, 7.77))
        self.assertEqual(insert["panel"], "landscape")
        self.assertIn("audio", insert["note"])

    def test_a_play_found_before_the_files_start_starts_with_the_file(self):
        span = {"start": 145.0, "end": 150.4, "offset": -145.821, "score": 0.52}
        insert = sync_inserts.draft_insert(span, "films/a.mp4", (1080, 1920), "audio")
        self.assertEqual((insert["at"], insert["src_at"], insert["panel"]), (145.821, 0.0, "portrait"))

    def test_a_file_that_started_before_the_camera_starts_at_the_cameras_first_frame(self):
        span = {"start": -0.5, "end": 30.0, "offset": 3.0, "score": 0.9}
        insert = sync_inserts.draft_insert(span, "screen.mkv", (1920, 1080), "visual")
        self.assertEqual((insert["at"], insert["src_at"]), (0.0, 3.0))


if __name__ == "__main__":
    unittest.main()
