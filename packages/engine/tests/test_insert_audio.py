# Created by The Angelo Umali.
# insert_audio: an insert's "clean" spans take the file's own sound on the panel's offset, faded into the room track.
import unittest

import numpy as np

from support import ENGINE  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import insert_audio

RATE = 1000


class CleanSpanTests(unittest.TestCase):
    def test_spans_carry_the_inserts_offset_and_file(self):
        inserts = [
            {"at": 10.0, "end": 20.0, "src": "a.mp4", "src_at": 2.0, "clean": [[10.0, 14.0], [16.0, 20.0]]},
            {"at": 30.0, "end": 40.0, "src": "b.mp4", "src_at": 0.0},
        ]
        self.assertEqual(insert_audio.clean_spans(inserts), [(10.0, 14.0, "a.mp4", -8.0), (16.0, 20.0, "a.mp4", -8.0)])

    def test_overlapping_spans_are_refused(self):
        inserts = [{"at": 0.0, "end": 10.0, "src": "a.mp4", "src_at": 0.0, "clean": [[1.0, 5.0], [4.0, 8.0]]}]
        with self.assertRaises(SystemExit):
            insert_audio.clean_spans(inserts)


class FileSliceTests(unittest.TestCase):
    def test_a_slice_before_the_files_start_is_padded_with_silence(self):
        film = np.ones((5 * RATE, 2))
        piece = insert_audio.file_slice(film, 0.0, 2.0, -1.0, RATE)  # file time -1 .. 1
        self.assertEqual(len(piece), 2 * RATE)
        self.assertEqual(piece[: RATE].max(), 0.0)
        self.assertEqual(piece[RATE:].min(), 1.0)


class BlendTests(unittest.TestCase):
    def test_inside_a_span_the_file_replaces_the_room_and_the_edges_fade(self):
        room = np.full((10 * RATE, 2), 0.5)
        clean = np.full((4 * RATE, 2), -0.25)
        mixed = insert_audio.blend(room, [(3.0, 7.0, clean)], RATE, fade=0.1)
        self.assertEqual(mixed[0, 0], 0.5)
        self.assertAlmostEqual(mixed[5 * RATE, 0], -0.25)
        edge = mixed[3 * RATE + 50, 0]  # halfway through the fade-in: both sides at equal power
        self.assertAlmostEqual(edge, 0.5 * np.sqrt(0.5) - 0.25 * np.sqrt(0.5), delta=0.02)

    def test_the_fade_out_mirrors_the_fade_in(self):
        mixed = insert_audio.blend(np.full((10 * RATE, 2), 0.5), [(3.0, 7.0, np.full((4 * RATE, 2), -0.25))], RATE, fade=0.1)
        self.assertAlmostEqual(mixed[3 * RATE + 50, 0], mixed[7 * RATE - 51, 0], delta=0.002)
        self.assertEqual(mixed[7 * RATE, 0], 0.5)

    def test_a_span_shorter_than_two_fades_fades_without_a_click(self):
        room = np.zeros((RATE, 2))
        mixed = insert_audio.blend(room, [(0.4, 0.5, np.ones((100, 2)))], RATE, fade=0.1)
        self.assertLess(np.abs(np.diff(mixed[:, 0])).max(), 0.05)

    def test_a_span_past_either_end_of_the_room_is_clipped_to_it(self):
        room = np.zeros((10 * RATE, 2))
        mixed = insert_audio.blend(room, [(-1.0, 2.0, np.ones((3 * RATE, 2))), (9.0, 11.0, np.ones((2 * RATE, 2)))], RATE, fade=0.1)
        self.assertEqual(len(mixed), 10 * RATE)
        self.assertEqual(mixed[RATE, 0], 1.0)
        self.assertEqual(mixed[int(9.5 * RATE), 0], 1.0)

    def test_a_track_with_headroom_is_left_alone(self):
        track = np.full((10, 2), 0.5)
        out, gain_db = insert_audio.headroom(track)
        self.assertIs(out, track)
        self.assertEqual(gain_db, 0.0)

    def test_a_peak_over_full_scale_scales_the_whole_track(self):
        track = np.array([[0.5, 0.5], [1.94, -1.94]])
        out, gain_db = insert_audio.headroom(track)
        self.assertAlmostEqual(np.abs(out).max(), insert_audio.HEADROOM)
        self.assertLess(gain_db, 0)


class GainTests(unittest.TestCase):
    def test_each_file_is_measured_on_its_own_longest_span(self):
        spans = [(0.0, 3.0, "a.mp4", -1.0), (5.0, 15.0, "a.mp4", -1.0), (20.0, 40.0, "b.mp4", 2.0)]
        self.assertEqual(insert_audio.reference_span(spans, "a.mp4"), (5.0, 15.0, "a.mp4", -1.0))
        self.assertEqual(insert_audio.reference_span(spans, "b.mp4")[:2], (20.0, 40.0))

    def test_the_file_is_matched_to_the_rooms_level_plus_presence(self):
        gain = insert_audio.match_gain(np.full(RATE, 0.1), np.full(RATE, 0.4))
        self.assertAlmostEqual(20 * np.log10(gain), 20 * np.log10(0.25) + insert_audio.PRESENCE_DB, delta=0.01)

    def test_a_silent_reference_is_refused_instead_of_a_huge_gain(self):
        with self.assertRaises(SystemExit):
            insert_audio.match_gain(np.full(RATE, 0.1), np.zeros(RATE))


if __name__ == "__main__":
    unittest.main()
