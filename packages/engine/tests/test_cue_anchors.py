# Created by The Angelo Umali.
# Cue anchors (plan §7.7): a cue must start on the word it is anchored to, checked when add_cue / update_cue write it.
import unittest

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine.specs import SpecError, anchor_word, validate_add_cue, validate_update_cue

# Transcript words as transcribe.py writes them: milliseconds, source time.
WORDS = [
    {"start": 1000, "end": 1300, "text": " So"},
    {"start": 1300, "end": 1700, "text": " here's"},
    {"start": 1700, "end": 2000, "text": " what"},
    {"start": 2000, "end": 2200, "text": " I"},
    {"start": 2200, "end": 2600, "text": " do."},
]


def keyword(at, **extra):
    return {"kind": "keyword", "at": at, "end": at + 1.5, "text": "Here's what I do", "anchor": {"phrase": "here's what", "wordIndex": 1}, **extra}


class AnchorWordTests(unittest.TestCase):
    def test_resolves_the_indexed_word_in_seconds(self):
        self.assertEqual(anchor_word({"phrase": "Here's what I", "wordIndex": 1}, WORDS), 1.3)

    def test_phrase_must_match_the_transcript_at_that_index(self):
        with self.assertRaisesRegex(SpecError, "does not match"):
            anchor_word({"phrase": "what I do", "wordIndex": 1}, WORDS)

    def test_index_past_the_transcript_fails(self):
        with self.assertRaisesRegex(SpecError, "wordIndex 9"):
            anchor_word({"phrase": "so", "wordIndex": 9}, WORDS)


class AddCueTests(unittest.TestCase):
    def test_cue_on_its_word_passes(self):
        self.assertEqual(validate_add_cue(keyword(1.3), WORDS)["at"], 1.3)

    def test_window_edges_pass(self):
        validate_add_cue(keyword(1.1), WORDS)
        validate_add_cue(keyword(3.1), WORDS)

    def test_cue_two_seconds_after_its_word_fails(self):
        with self.assertRaisesRegex(SpecError, r"2\.00 s after"):
            validate_add_cue(keyword(3.3), WORDS)

    def test_cue_early_beyond_tolerance_fails(self):
        with self.assertRaisesRegex(SpecError, "before"):
            validate_add_cue(keyword(1.0), WORDS)

    def test_missing_anchor_fails_for_an_authored_kind(self):
        cue = keyword(1.3)
        del cue["anchor"]
        with self.assertRaisesRegex(SpecError, "anchor"):
            validate_add_cue(cue, WORDS)

    def test_derived_kinds_need_no_anchor(self):
        validate_add_cue({"kind": "caption", "at": 1.0, "end": 2.0, "text": "So"}, WORDS)

    def test_schema_and_width_still_apply(self):
        with self.assertRaisesRegex(SpecError, "27"):
            validate_add_cue(keyword(1.3, tone="chip", text="x" * 28), WORDS)
        with self.assertRaisesRegex(SpecError, "pipeline"):
            validate_add_cue({"kind": "pipeline", "at": 1.3, "end": 3, "steps": [], "anchor": {"phrase": "here's", "wordIndex": 1}}, WORDS)


class UpdateCueTests(unittest.TestCase):
    def test_patch_merges_and_revalidates(self):
        updated = validate_update_cue(keyword(1.3), {"at": 1.5, "text": "What I do"}, WORDS)
        self.assertEqual((updated["at"], updated["text"]), (1.5, "What I do"))

    def test_patch_moving_the_cue_off_its_word_fails(self):
        with self.assertRaisesRegex(SpecError, "after"):
            validate_update_cue(keyword(1.3), {"at": 3.5, "end": 4.5}, WORDS)

    def test_null_removes_an_optional_field(self):
        self.assertNotIn("tone", validate_update_cue(keyword(1.3, tone="paper"), {"tone": None}, WORDS))

    def test_stored_cue_is_not_mutated(self):
        stored = keyword(1.3)
        validate_update_cue(stored, {"text": "Changed"}, WORDS)
        self.assertEqual(stored["text"], "Here's what I do")


if __name__ == "__main__":
    unittest.main()
