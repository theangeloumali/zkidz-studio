# Created by The Angelo Umali.
# The four herk QC gates and the motion gate as pure functions over arrays and specs (plan §7.6).
import unittest
from unittest import mock

import numpy as np

from support import make_edl, seconds  # first: it sets a scratch ZKS_HOME

from zks_engine import qc
from zks_engine.qc import contrast, lipsync, motion, mouth, timeline, words

# Frames 0-60 kept, 60-90 cut, 90-180 kept: one cut at edited frame 60 (2.002 s).
EDL = make_edl([(0, 60), (90, 180)])
INTRO = {"at": 30, "frames": 60}


class TimelineTests(unittest.TestCase):
    def test_cuts_are_the_targets_of_every_segment_after_the_first(self):
        self.assertEqual(timeline.cut_frames(EDL), [60])

    def test_frames_after_the_intro_insert_shift_by_its_length(self):
        self.assertEqual(timeline.master_frame(10, INTRO), 10)
        self.assertEqual(timeline.master_frame(30, INTRO), 90)
        self.assertEqual(timeline.master_frame(30, None), 30)

    def test_edited_frame_maps_back_to_its_source_frame(self):
        self.assertEqual(timeline.source_frame(10, EDL), 10)
        self.assertEqual(timeline.source_frame(60, EDL), 90)
        self.assertIsNone(timeline.source_frame(500, EDL))


class WordGateTests(unittest.TestCase):
    WORDS = [{"at": 0.5, "end": 0.9, "text": " hello"}, {"at": 1.8, "end": 2.2, "text": " world"}, {"at": 3.2, "end": 3.5, "text": " again"}]

    def test_a_word_straddling_a_cut_is_clipped(self):
        problems = words.clipped_words(self.WORDS, EDL)
        self.assertEqual(len(problems), 1)
        self.assertIn("'world'", problems[0])

    def test_a_cut_in_a_pause_clips_nothing(self):
        self.assertEqual(words.clipped_words([self.WORDS[0], self.WORDS[2]], EDL), [])

    def test_a_missing_word_fails_the_diff(self):
        problems = words.diff_problems([("so", False), ("we", False), ("ship", False)], ["so", "ship"])
        self.assertEqual(problems, [("'we' is missing", 1)])

    def test_a_repeated_word_fails_the_diff(self):
        self.assertEqual(words.diff_problems([("so", False), ("we", False), ("ship", False)], ["so", "we", "we", "ship"]), [("'we' is repeated", None)])

    def test_close_mishearings_and_optional_edge_words_pass(self):
        self.assertEqual(words.diff_problems([("edge", True), ("claude", False), ("code", False)], ["cloude", "code"]), [])

    # Long-form whisper times drift: ep 12 put "kasi nga yun" at 168.37-168.98, heard alone at 169.2-169.69, wholly inside
    # the cut. A flagged word is re-heard alone in the source, and stands only if that hearing still shows the damage.
    ALONE = [{"at": 1.2, "end": 1.5, "text": " it"}, {"at": 2.1, "end": 2.5, "text": " kasi"}, {"at": 2.5, "end": 2.8, "text": " nga"}]

    def hear_alone(self, heard):
        return lambda start, end: [word for word in heard if word["end"] > start and word["at"] < end]

    def test_a_word_clipped_only_by_drifted_times_passes_once_heard_alone(self):
        drifted = [{"at": 1.2, "end": 1.5, "text": " it"}, {"at": 1.8, "end": 2.2, "text": " kasi"}, {"at": 2.2, "end": 2.5, "text": " nga"}]
        self.assertEqual(words.clipped_words(drifted, EDL, self.hear_alone(self.ALONE)), [])
        really_clipped = [{**word, "at": word["at"] - 0.25, "end": word["end"] - 0.25} for word in self.ALONE]
        self.assertEqual(len(words.clipped_words(drifted, EDL, self.hear_alone(really_clipped))), 1)

    # Maya's repro: heard alone, whisper merged the two "okay"s into one, and the clipped one took the other's time.
    def test_a_repeated_word_the_hearing_merged_keeps_its_flag(self):
        spoken = [{"at": 1.2, "end": 1.5, "text": " it"}, {"at": 1.8, "end": 2.2, "text": " okay"}, {"at": 3.2, "end": 3.5, "text": " okay"}]
        merged = [{"at": 1.2, "end": 1.5, "text": " it"}, {"at": 3.2, "end": 3.5, "text": " okay"}]
        self.assertEqual(len(words.clipped_words(spoken, EDL, self.hear_alone(merged))), 1)

    def test_a_word_missing_at_two_nearby_cuts_is_heard_alone_once(self):
        # Cuts at edited 2.00 and 3.00 s: 'kasi' at 1.78 s is required in both cuts' windows.
        two_cuts = make_edl([(0, 60), (90, 120), (150, 240)])
        spoken = [{"at": 1.2, "end": 1.5, "text": " it"}, {"at": 1.78, "end": 1.98, "text": " kasi"}]
        master = self.hear_alone([{"at": 1.2, "end": 1.5, "text": " it"}])
        calls = []

        def hear(start, end):
            calls.append((start, end))
            return self.hear_alone([{"at": 1.2, "end": 1.5, "text": " it"}, {"at": 1.78, "end": 1.98, "text": " kasi"}])(start, end)

        self.assertEqual(len(words.cut_word_problems(spoken, two_cuts, None, master, hear)), 2)
        self.assertEqual(len(calls), 1)

    def test_a_word_missing_only_by_drifted_times_passes_once_heard_alone(self):
        spoken = [{"at": 0.78, "end": 0.95, "text": " hello"}, {"at": 1.2, "end": 1.5, "text": " it"}, {"at": 1.55, "end": 1.9, "text": " kasi"},
                  {"at": 3.2, "end": 3.5, "text": " again"}]

        # The master plays hello and it before the cut and again after it, at edited 2.2 s.
        master = self.hear_alone([{"at": 0.78, "end": 0.95, "text": " hello"}, {"at": 1.2, "end": 1.5, "text": " it"}, {"at": 2.2, "end": 2.5, "text": " again"}])
        self.assertEqual(words.cut_word_problems(spoken, EDL, None, master), ["cut at 2.00 s: 'kasi' is missing"])
        self.assertEqual(words.cut_word_problems(spoken, EDL, None, master, self.hear_alone(self.ALONE)), [])
        kept_alone = [{"at": 1.2, "end": 1.5, "text": " it"}, {"at": 1.55, "end": 1.9, "text": " kasi"}]
        self.assertEqual(words.cut_word_problems(spoken, EDL, None, master, self.hear_alone(kept_alone)), ["cut at 2.00 s: 'kasi' is missing"])

    # The cut's window runs across the brand intro: the words before it play before the intro, not in its silence.
    def test_a_window_across_the_intro_is_heard_on_both_sides_of_it(self):
        heard_ranges = []

        def hear(start_s, end_s):
            heard_ranges.append((start_s, end_s))
            return [{"text": " hello"}] if end_s <= INTRO["at"] / 29.97 + 0.01 else [{"text": " again"}]

        spoken = [{"at": 0.78, "end": 0.95, "text": " hello"}, {"at": 3.2, "end": 3.5, "text": " again"}]
        self.assertEqual(words.cut_word_problems(spoken, EDL, INTRO, hear), [])
        intro_start, intro_end = timeline.master_seconds(INTRO["at"] - 1, EDL, INTRO), timeline.master_seconds(INTRO["at"], EDL, INTRO)
        self.assertTrue(all(end <= intro_start + 0.05 or start >= intro_end - 0.05 for start, end in heard_ranges), heard_ranges)

    def test_tokens_drop_case_and_punctuation(self):
        self.assertEqual(words.token(" Hello,"), "hello")


class TranscriberTests(unittest.TestCase):
    # Windows are heard one after another; one thread made a turbo QC take 17 minutes, and every core ran slower than half.
    def test_a_whisper_run_without_a_thread_count_takes_half_the_cores(self):
        failed = mock.Mock(returncode=1, stderr="stop here")
        with mock.patch.object(qc.whispercpp.os, "cpu_count", return_value=24), \
                mock.patch.object(qc.whispercpp, "cli_path", return_value="whisper-cli"), \
                mock.patch.object(qc.whispercpp.subprocess, "run", return_value=failed) as run, \
                self.assertRaises(RuntimeError):
            qc.whispercpp.transcribe_file("w.wav", "tl", "m.bin")
        argv = run.call_args.args[0]
        self.assertEqual(argv[argv.index("-t") + 1], "12")


class ContrastTests(unittest.TestCase):
    def test_wcag_ratio_of_black_on_white_is_21(self):
        self.assertAlmostEqual(contrast.contrast_ratio((0, 0, 0), (255, 255, 255)), 21.0, places=1)

    def test_white_text_on_a_white_wall_fails(self):
        frame = np.full((1920, 1080, 3), 250, np.uint8)
        self.assertLess(contrast.caption_contrast(frame, contrast.caption_box(1430), (255, 255, 255)), contrast.MIN_CONTRAST)

    def test_white_text_on_the_ink_plate_passes(self):
        frame = np.full((1920, 1080, 3), 250, np.uint8)
        x, y, w, h = contrast.caption_box(1430)
        frame[y:y + h, x:x + w] = (23, 34, 48)
        frame[y + 40:y + 60, x + 50:x + 300] = 255  # the text strokes, a minority of the plate
        self.assertGreater(contrast.caption_contrast(frame, (x, y, w, h), (255, 255, 255)), contrast.MIN_CONTRAST)


class MouthTests(unittest.TestCase):
    def test_an_opaque_box_over_the_mouth_covers_it(self):
        alpha = np.zeros((1920, 1080), np.uint8)
        x, y, w, h = mouth.MOUTH_BOX
        alpha[y:y + h // 2, x:x + w] = 255
        self.assertGreater(mouth.covered_fraction(alpha, mouth.MOUTH_BOX), mouth.MAX_COVERED)

    def test_a_caption_below_the_chin_leaves_the_mouth_clear(self):
        alpha = np.zeros((1920, 1080), np.uint8)
        alpha[1600:1750] = 255
        self.assertEqual(mouth.covered_fraction(alpha, mouth.MOUTH_BOX), 0)

    def test_hook_frames_are_capped_by_the_intro_and_kept_to_face_cam(self):
        self.assertEqual(mouth.hook_frames(EDL, None, []), list(range(75)))
        self.assertEqual(mouth.hook_frames(EDL, INTRO, []), list(range(30)))
        self.assertEqual(mouth.hook_frames(EDL, None, [[seconds(10), seconds(20)]]), list(range(10, 20)))


class LipSyncTests(unittest.TestCase):
    def setUp(self):
        self.random = np.random.default_rng(7)

    def test_video_offset_finds_the_matching_source_frames(self):
        source = self.random.random((14, 8, 8)).astype(np.float32)
        offset, confident = lipsync.video_offset(source[4:12], source, reach=3)
        self.assertEqual((offset, confident), (1, True))

    def test_audio_offset_finds_the_lag_in_frames(self):
        rate, reach_s = 16000, 3 / 29.97
        source = self.random.standard_normal(rate)
        start = round(reach_s * rate) + 534  # one frame later
        offset, confident = lipsync.audio_offset(source[start:start + 8000], source[:8000 + 2 * round(reach_s * rate)], rate, reach_s, 29.97)
        self.assertTrue(confident)
        self.assertAlmostEqual(offset, 1.0, places=1)

    def test_a_one_frame_slip_fails_and_a_match_passes(self):
        self.assertTrue(lipsync.is_slipped(video_offset=0, audio_offset=1.0))
        self.assertFalse(lipsync.is_slipped(video_offset=1, audio_offset=1.02))


class MotionTests(unittest.TestCase):
    def test_frozen_frames_under_moving_original_fail(self):
        moving = np.random.default_rng(3).random((12, 40, 40)).astype(np.float32) * 255
        frozen = np.repeat(moving[:1], 12, axis=0)
        self.assertTrue(motion.is_frozen(motion.motion_stats(moving), motion.motion_stats(frozen)))
        self.assertFalse(motion.is_frozen(motion.motion_stats(moving), motion.motion_stats(moving)))

    def test_an_intentional_still_is_not_frozen(self):
        still = np.full((12, 40, 40), 90, np.float32)
        self.assertFalse(motion.is_frozen(motion.motion_stats(still), motion.motion_stats(still)))

    def test_shots_skip_segments_too_short_to_sample(self):
        self.assertEqual([seg["in"] for seg in motion.shots(make_edl([(0, 20), (40, 200)]))], [40])


if __name__ == "__main__":
    unittest.main()
