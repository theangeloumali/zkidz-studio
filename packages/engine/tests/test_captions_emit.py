# Created by The Angelo Umali.
# captions.emit_cues writes derived/cues/<video>-cc.json, the only cue format hf reads (plan §7.7).
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import captions
from zks_engine.specs import validate

PHRASES = [{"at": 1.0, "end": 2.0, "text": "kumusta", "reel": 0}, {"at": 2.5, "end": 3.5, "text": "salamat", "reel": 0}]
ENTRIES = [{"ids": [1], "en": "thank you ", "bottom": 1750}, {"ids": [0], "en": "hello"}]


class EmitCuesTests(unittest.TestCase):
    def test_writes_a_json_cue_array_hf_can_load(self):
        with tempfile.TemporaryDirectory() as folder:
            work = Path(folder)
            for sub in ("captions", "cues"):
                (work / sub).mkdir()
            (work / "captions" / "v1.phrases.json").write_text(json.dumps(PHRASES), encoding="utf-8")
            (work / "captions" / "v1.json").write_text(json.dumps(ENTRIES), encoding="utf-8")
            with mock.patch.object(captions, "WORK", work), mock.patch("builtins.print"):
                captions.emit_cues("v1")

            self.assertFalse((work / "cues" / "v1-cc.js").exists())
            self.assertFalse((work / "cues" / "v1-cc.json").exists())
            cues = json.loads((work / "derived" / "cues" / "v1-cc.json").read_text(encoding="utf-8"))
            validate("cue-sheet", cues)
            self.assertEqual(
                cues,
                [
                    {"kind": "caption", "at": 1.0, "end": 2.0, "text": "hello"},
                    {"kind": "caption", "at": 2.5, "end": 3.5, "text": "thank you", "bottom": 1750},
                ],
            )


WORD_PHRASES = [{"id": 0, "at": 0.0, "end": 1.5, "reel": None, "text": "isa"}, {"id": 1, "at": 1.5, "end": 3.0, "reel": None, "text": "dalawa"}]


def emitted_words(entries, phrases=WORD_PHRASES, transcript=(), base="t", words=True):
    """emit_cues' cues for `entries`; `transcript` is the EDL base's whisper words as (text, start s, end s)."""
    with tempfile.TemporaryDirectory() as folder:
        work = Path(folder)
        for sub in ("captions", "transcripts", "edl"):
            (work / sub).mkdir()
        (work / "captions" / "t.phrases.json").write_text(json.dumps(phrases), encoding="utf-8")
        (work / "captions" / "t.json").write_text(json.dumps(entries), encoding="utf-8")
        studio = [{"at": start, "end": end, "text": text} for text, start, end in transcript]
        (work / "transcripts" / f"{base}.words.json").write_text(json.dumps(studio), encoding="utf-8")
        (work / "edl" / "t.json").write_text(json.dumps({"segments": [{"in": 0, "out": 100000, "target": 0}], "base": base}), encoding="utf-8")
        with mock.patch.object(captions, "WORK", work), mock.patch("zks_engine.pipeline.WORK", work), mock.patch("builtins.print"):
            captions.emit_cues("t", words=words)
        cues = json.loads((work / "derived" / "cues" / "t-cc.json").read_text(encoding="utf-8"))
    validate("cue-sheet", cues)
    return cues


def states(cues):
    return [(cue["text"], cue["at"], cue["end"]) for cue in cues]


class WordCaptionTests(unittest.TestCase):
    """The learning theme's captions: one cue per word state, building a 1-4 word line that clears when it is full."""

    def test_taglish_speech_spreads_the_words_by_character_count(self):
        cues = emitted_words([{"ids": [0, 1], "en": "One two three."}])
        self.assertEqual(states(cues), [("One", 0.0, 0.75), ("One two", 0.75, 1.5), ("One two three.", 1.5, 3.0)])
        self.assertEqual({(cue["kind"], cue["style"], cue["line"], cue["scale"], cue["bottom"]) for cue in cues},
                         {("caption", "words", "One two three.", 1, 1750)})
        self.assertEqual([cue["pills"] for cue in cues], [[], [], []])

    def test_english_speech_takes_whisper_word_times_from_the_nearest_run(self):
        phrases = [{"id": 0, "at": 1.0, "end": 2.0, "reel": None, "text": "So I asked"}]
        transcript = [("so", 1.05, 1.2), ("I", 1.3, 1.4), ("asked", 1.5, 1.9), ("So", 8.0, 8.1), ("I", 8.2, 8.3), ("asked", 8.4, 8.6)]
        cues = emitted_words([{"ids": [0], "en": "So I asked."}], phrases=phrases, transcript=transcript)
        self.assertEqual(states(cues), [("So", 1.0, 1.3), ("So I", 1.3, 1.5), ("So I asked.", 1.5, 2.0)])

    def test_a_reel_takes_its_base_transcript(self):
        phrases = [{"id": 0, "at": 1.0, "end": 2.0, "reel": None, "text": "So I asked"}]
        transcript = [("so", 1.05, 1.2), ("I", 1.3, 1.4), ("asked", 1.5, 1.9)]
        cues = emitted_words([{"ids": [0], "en": "So I asked."}], phrases=phrases, transcript=transcript, base="full")
        self.assertEqual([cue["at"] for cue in cues], [1.0, 1.3, 1.5])

    def test_a_translation_ignores_the_transcript(self):
        cues = emitted_words([{"ids": [0, 1], "en": "One two three."}], transcript=[("isa", 0.1, 0.5), ("dalawa", 1.6, 2.2)])
        self.assertEqual([cue["at"] for cue in cues], [0.0, 0.75, 1.5])

    def test_more_than_four_words_start_a_new_group_that_clears_the_full_line(self):
        cues = emitted_words([{"ids": [0, 1], "en": "a b c d e f"}])
        self.assertEqual([cue["text"] for cue in cues], ["a", "a b", "a b c", "a b c d", "e", "e f"])
        self.assertEqual([cue["line"] for cue in cues], ["a b c d"] * 4 + ["e f"] * 2)
        self.assertEqual(cues[3]["end"], cues[4]["at"])

    def test_pills_index_the_line(self):
        cues = emitted_words([{"ids": [0, 1], "en": "the cat and the dog", "pills": ["dog", "the", "the"]}])
        self.assertEqual(cues[3]["pills"], [0, 3])
        self.assertEqual(cues[4]["pills"], [0])

    def test_a_pill_not_in_the_english_is_refused_by_name(self):
        with self.assertRaisesRegex(SystemExit, "'cats'"):
            emitted_words([{"ids": [0, 1], "en": "the cat", "pills": ["cats"]}])

    def test_a_word_wider_than_a_line_is_refused(self):
        with self.assertRaisesRegex(SystemExit, "Supercalifragilisticexpialidocious"):
            emitted_words([{"ids": [0, 1], "en": "Supercalifragilisticexpialidocious", "scale": 2.0}])

    def test_unknown_ids_are_refused_not_crashing(self):
        with self.assertRaisesRegex(SystemExit, "7"):
            emitted_words([{"ids": [0, 1], "en": "One two."}, {"ids": [7], "en": "x"}])

    def test_a_long_entry_is_not_held_to_the_plates_two_lines(self):
        cues = emitted_words([{"ids": [0, 1], "en": "word " * 14}])
        self.assertEqual(len(cues), 14)

    def test_scale_and_bottom_per_entry(self):
        cues = emitted_words([{"ids": [0], "en": "Big.", "scale": 1.4, "bottom": 1500}, {"ids": [1], "en": "Small."}])
        self.assertEqual([(cue["scale"], cue["bottom"]) for cue in cues], [(1.4, 1500), (1, captions.WORDS_BOTTOM)])

    def test_the_house_sheet_ignores_pills(self):
        cues = emitted_words([{"ids": [0], "en": "One."}, {"ids": [1], "en": "Two.", "pills": ["Two"]}], words=False)
        self.assertEqual(cues, [{"kind": "caption", "at": 0.0, "end": 1.5, "text": "One."}, {"kind": "caption", "at": 1.5, "end": 3.0, "text": "Two."}])


class WordStyleTests(unittest.TestCase):
    def theme_of(self, style):
        with tempfile.TemporaryDirectory() as folder:
            work = Path(folder)
            if style is not None:
                (work / "style.json").write_text(json.dumps(style), encoding="utf-8")
            return captions.word_style(work)

    def test_only_the_learning_theme_takes_word_captions(self):
        self.assertTrue(self.theme_of({"theme": "learning"}))
        self.assertFalse(self.theme_of({"theme": "zkidz"}))
        self.assertFalse(self.theme_of({}))
        self.assertFalse(self.theme_of(None))


if __name__ == "__main__":
    unittest.main()


class EmptyPhraseTests(unittest.TestCase):
    def test_a_phrase_squeezed_to_no_time_joins_the_one_before_it(self):
        from zks_engine import captions

        phrases = [
            {"id": 0, "at": 0.28, "end": 2.0, "reel": None, "text": "git clone natin."},
            {"id": 1, "at": 2.0, "end": 2.0, "reel": None, "text": "Git clone."},
            {"id": 2, "at": 2.0, "end": 3.6, "reel": None, "text": "Git? Git,"},
        ]
        self.assertEqual(
            captions.merge_empty_phrases(phrases),
            [
                {"id": 0, "at": 0.28, "end": 2.0, "reel": None, "text": "git clone natin. Git clone."},
                {"id": 1, "at": 2.0, "end": 3.6, "reel": None, "text": "Git? Git,"},
            ],
        )

    def test_an_empty_first_phrase_joins_the_one_after_it(self):
        from zks_engine import captions

        phrases = [{"id": 0, "at": 1.0, "end": 1.0, "reel": None, "text": "So"}, {"id": 1, "at": 1.0, "end": 2.5, "reel": None, "text": "git clone"}]
        self.assertEqual(captions.merge_empty_phrases(phrases), [{"id": 0, "at": 1.0, "end": 2.5, "reel": None, "text": "So git clone"}])
