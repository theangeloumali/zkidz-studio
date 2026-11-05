# Created by The Angelo Umali.
# caption_words: the word-state layout of the learning theme's captions (pills, 1-4 word lines, scale, word timing).
import unittest

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import caption_words


class PillTests(unittest.TestCase):
    def test_pills_match_words_ignoring_case_and_punctuation(self):
        self.assertEqual(caption_words.pill_indexes(["It", "got", "bigger."], ["Bigger"]), ([2], []))

    def test_a_repeated_pill_takes_the_next_free_occurrence(self):
        words = "the cat and the dog".split()
        self.assertEqual(caption_words.pill_indexes(words, ["dog", "the", "the"]), ([0, 3, 4], []))

    def test_a_pill_not_in_the_words_is_missing(self):
        self.assertEqual(caption_words.pill_indexes(["the", "cat"], ["cats", "cat", "cat"]), ([1], ["cats", "cat"]))


class GroupTests(unittest.TestCase):
    def test_at_most_four_words_a_line(self):
        self.assertEqual(caption_words.word_groups(list("abcdef"), [], 1), [[0, 1, 2, 3], [4, 5]])

    def test_wide_capitals_break_where_their_real_width_does(self):
        # 946 px of W and M at 60 px: an average-width estimate kept them on one 900 px line, which the renderer refused.
        words = ["WWWWWW", "MMMMMM", "WWWWWW"]
        self.assertGreater(len(caption_words.word_groups(words, [], 1)), 1)
        self.assertGreater(caption_words.line_px(words, [], [0, 1, 2], 1), caption_words.WORD_LINE_PX)

    def test_a_pill_pads_its_word(self):
        plain = caption_words.line_px(["go"], [], [0], 1)
        self.assertAlmostEqual(caption_words.line_px(["go"], [0], [0], 1) - plain, 2 * caption_words.WORD_PILL_PAD)

    def test_a_larger_scale_splits_the_line(self):
        words = ["Extraordinarily", "complicated"]
        self.assertEqual(caption_words.word_groups(words, [], 1), [[0, 1]])
        self.assertEqual(caption_words.word_groups(words, [], 2.0), [[0], [1]])


class CheckTests(unittest.TestCase):
    def test_a_valid_entry_passes(self):
        self.assertEqual(caption_words.check_words({"en": "It got bigger.", "pills": ["bigger"], "scale": 1.4}, [0]), [])

    def test_a_pill_not_in_en_is_named(self):
        problems = caption_words.check_words({"en": "the cat", "pills": ["cats"]}, [0])
        self.assertEqual(len(problems), 1)
        self.assertIn("'cats'", problems[0])

    def test_scale_out_of_range_or_not_a_number(self):
        for scale in (0.5, 2.5, "big", True):
            with self.subTest(scale=scale):
                self.assertRegex(" ".join(caption_words.check_words({"en": "One two.", "scale": scale}, [0])), "scale")

    def test_one_word_wider_than_a_line_is_named(self):
        problems = caption_words.check_words({"en": "Supercalifragilisticexpialidocious", "scale": 2.0}, [0])
        self.assertTrue(any("Supercalifragilisticexpialidocious" in problem for problem in problems))


class TimingTests(unittest.TestCase):
    def test_without_word_times_the_span_is_shared_by_character_count(self):
        self.assertEqual(caption_words.word_starts(["One", "two", "three."], (0.0, 3.0), None), [0.0, 0.75, 1.5])

    def test_spoken_words_take_whisper_starts_clamped_to_the_span(self):
        spoken = [{"start": 0.9}, {"start": 1.3}, {"start": 2.5}]
        self.assertEqual(caption_words.word_starts(["So", "I", "asked."], (1.0, 2.0), spoken), [1.0, 1.3, 2.0])


if __name__ == "__main__":
    unittest.main()
