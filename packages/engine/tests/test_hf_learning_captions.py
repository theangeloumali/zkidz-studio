# Created by The Angelo Umali.
# Word captions (caption style "words"): HF-native lines built word by word on the learning tokens, split at cover edges,
# and drawn on their own layer (build.js --layer captions) that caption_layer.py lays over the cards. Needs node only.
import json
import os
import re
import subprocess
import tempfile
import unittest

from support import ENGINE, hf_installed, make_edl, needs_renderer, scratch_work  # first: it sets a scratch ZKS_HOME
from test_hf_bridge import build, tweens


def cue_kinds(work, folder):
    """The kinds a built composition hf/<folder>/ draws, sorted."""
    return sorted(cue["kind"] for cue in json.loads((work / "hf" / folder / "cues.json").read_text(encoding="utf-8")))


# Runs {cue, cues, fps} through the caption component, or {motion: [cue, placed, fps]} through render.js captionMotion, or
# {hold: [placed, next, nextCue]} through joinHold, or {split: cues} through build.js splitAtCovers; prints the result as JSON.
CAPTION_PROBE = """
const path = require("path");
const input = JSON.parse(require("fs").readFileSync(0, "utf8"));
const hf = path.join(process.argv[1], "hf");
const { caption } = require(path.join(hf, "components", "captions.js"));
const render = require(path.join(hf, "render.js"));
let out;
if (input.split) out = require(path.join(hf, "build.js")).splitAtCovers(input.split);
else if (input.motion) out = render.captionMotion(...input.motion);
else if (input.hold) out = render.joinHold(...input.hold);
else out = caption.render(input.cue, { duration: input.cue.stop - input.cue.start, cues: input.cues ?? [], fps: input.fps ?? 30000 / 1001 });
console.log(JSON.stringify(out));
"""
FPS = 30000 / 1001
INK, ACCENT, WHITE = "#172230", "#C9A838", "#FFFFFF"  # the learning tokens (hf/learning/tokens.js)


def probe(payload):
    result = subprocess.run(["node", "-e", CAPTION_PROBE, str(ENGINE)], capture_output=True, text=True, encoding="utf-8", input=json.dumps(payload))
    if result.returncode:
        raise AssertionError(result.stderr)
    return json.loads(result.stdout)


def words_cue(text, line=None, **fields):
    return {"kind": "caption", "style": "words", "start": 1.0, "stop": 1.5, "text": text, "line": line or text, "pills": [], "scale": 1,
            "seed": 9001, "joinsBefore": False, "joinsAfter": False, **fields}


def word_texts(html):
    """(x, y, fill, word) of each <text> in a words plate."""
    return [(float(x), float(y), fill, word) for x, y, fill, word in re.findall(r'<text x="([\d.]+)" y="([\d.]+)"[^>]* fill="([^"]+)"[^>]*>([^<]*)</text>', html)]


@needs_renderer(hf_installed())
class WordsPlateTests(unittest.TestCase):
    """style "words": HF-native SVG type on the learning tokens, no canvas plate."""

    def test_the_plate_is_chakra_petch_semibold_at_its_scale(self):
        html = probe({"cue": words_cue("One two")})["html"]
        self.assertIn('font-family="Chakra Petch" font-weight="600" font-size="60"', html)
        self.assertIn('class="u plate words"', html)
        self.assertIn('font-size="84"', probe({"cue": words_cue("Big", scale=1.4)})["html"])

    def test_only_said_words_are_drawn_where_the_full_line_puts_them(self):
        first = word_texts(probe({"cue": words_cue("One", "One two three")})["html"])
        second = word_texts(probe({"cue": words_cue("One two", "One two three")})["html"])
        self.assertEqual([word for *_, word in first], ["One"])
        self.assertEqual(second[0], first[0], "a shared word moves between states")
        full = word_texts(probe({"cue": words_cue("One two three")})["html"])
        self.assertAlmostEqual((full[0][0] + full[-1][0]) / 2, 540, delta=120)  # the whole line is centred
        self.assertEqual({y for _, y, *_ in full}, {1750.0})

    def test_pills_are_gold_with_navy_type(self):
        html = probe({"cue": words_cue("It got", "It got bigger.", pills=[2])})["html"]
        self.assertNotIn('class="pill"', html, "a pill shows before its word is said")
        html = probe({"cue": words_cue("It got bigger.", pills=[2])})["html"]
        self.assertEqual(html.count('class="pill"'), 1)
        self.assertIn(f'fill="{ACCENT}"', html)
        texts = word_texts(html)
        self.assertEqual(texts[-1][2:], (INK, "bigger."))

    def test_white_with_a_shadow_on_footage_ink_without_one_on_a_cover(self):
        cutaway = {"kind": "cutaway", "start": 0.5, "stop": 2.4, "cover": 1.4}
        on_footage = probe({"cue": words_cue("One")})["html"]
        self.assertEqual(word_texts(on_footage)[0][2], "#FFFFFF")
        self.assertIn("feDropShadow", on_footage)
        on_paper = probe({"cue": words_cue("One"), "cues": [cutaway]})["html"]
        self.assertEqual(word_texts(on_paper)[0][2], INK)
        self.assertNotIn("feDropShadow", on_paper)
        # The state's start decides: one starting after the cover (in its wipe out) is on footage again.
        after = probe({"cue": words_cue("One", start=2.0, stop=2.6), "cues": [cutaway]})["html"]
        self.assertEqual(word_texts(after)[0][2], "#FFFFFF")

    def test_a_words_caption_rides_above_a_name_plate_it_meets(self):
        plate = {"kind": "lowerThird", "start": 0.8, "stop": 2.0, "y": 1650}
        lifted = word_texts(probe({"cue": words_cue("One"), "cues": [plate]})["html"])
        self.assertLess(lifted[0][1], 1650, "the words caption covers the name plate (y 1650)")
        later = {**plate, "start": 1.6, "stop": 3.0}
        self.assertEqual(word_texts(probe({"cue": words_cue("One"), "cues": [later]})["html"])[0][1], 1750.0)

    def test_the_baseline_stays_inside_the_frame_at_any_scale(self):
        html = probe({"cue": words_cue("Low", scale=2.0, bottom=1915)})["html"]
        baseline = word_texts(html)[0][1]
        self.assertLessEqual(baseline + 0.22 * 120 + 4, 1920)
        self.assertEqual(word_texts(probe({"cue": words_cue("Up", bottom=1500)})["html"])[0][1], 1500)

    def test_a_line_wider_than_the_frame_is_refused_by_name(self):
        with self.assertRaisesRegex(AssertionError, "WWWWWWWWWWWWWWWWWWWW"):
            probe({"cue": words_cue("WWWWWWWWWWWWWWWWWWWW", scale=2.0)})

    def test_the_text_must_start_the_line(self):
        with self.assertRaisesRegex(AssertionError, "not the start of its line"):
            probe({"cue": words_cue("two", "One two")})

    def test_entrances(self):
        risen = probe({"cue": words_cue("One")})["motion"]
        self.assertEqual([spec["target"] for spec in risen], [".plate", ".plate"])  # today's rise, travel and alpha
        self.assertEqual(probe({"cue": words_cue("One", joinsBefore=True)})["motion"], [], "a new line swaps in like a joined caption")
        fade, = probe({"cue": words_cue("One two", joinsBefore=True)})["motion"]
        self.assertEqual((fade["target"], fade["from"], fade["to"]["opacity"]), (".plate", {"opacity": 0}, 1))
        self.assertAlmostEqual(fade["at"], -1 / FPS)
        self.assertAlmostEqual(fade["to"]["duration"], 4 / FPS)

    def test_house_captions_still_draw_the_canvas_plate(self):
        html = probe({"cue": {"kind": "caption", "start": 1.0, "stop": 2.0, "text": "House.", "seed": 9001}})["html"]
        self.assertNotIn("words", html)
        self.assertIn("<svg", html)


@needs_renderer(hf_installed())
class WordsJoinMotionTests(unittest.TestCase):
    """A state continuing its line fades in over 3 frames while the state before it is held underneath."""

    def test_a_continuing_state_fades_in_over_three_frames(self):
        cue = words_cue("One two", joinsBefore=True, joinsAfter=True)
        motion = probe({"motion": [cue, {"firstFrame": 30, "endFrame": 45}, FPS]})
        self.assertEqual(motion, [[30, 0.4375, 0], [31, 0.75, 0], [32, 0.9375, 0]])

    def test_a_new_line_and_a_joined_house_caption_swap_without_motion(self):
        placed = {"firstFrame": 30, "endFrame": 45}
        self.assertEqual(probe({"motion": [words_cue("One", joinsBefore=True, joinsAfter=True), placed, FPS]}), [])
        house = {"kind": "caption", "start": 1.0, "stop": 1.5, "text": "House two", "joinsBefore": True, "joinsAfter": True}
        self.assertEqual(probe({"motion": [house, placed, FPS]}), [])

    def test_a_state_whose_predecessor_was_cut_rises(self):
        # A reel EDL dropped the state before it: nothing joins, so it enters like any caption.
        motion = probe({"motion": [words_cue("One two", start=30 / FPS), {"firstFrame": 30, "endFrame": 45}, FPS]})
        self.assertGreater(motion[0][2], 5)

    def test_the_previous_state_is_held_until_the_new_one_is_full(self):
        before = {"firstFrame": 20, "endFrame": 30}
        continuing = words_cue("One two", joinsBefore=True)
        self.assertEqual(probe({"hold": [before, {"firstFrame": 30, "endFrame": 45}, continuing]}), 3)
        self.assertEqual(probe({"hold": [before, {"firstFrame": 30, "endFrame": 32}, continuing]}), 2)  # never past the next state
        self.assertEqual(probe({"hold": [before, {"firstFrame": 31, "endFrame": 45}, continuing]}), 0)  # a gap: nothing to hold
        self.assertEqual(probe({"hold": [before, {"firstFrame": 30, "endFrame": 45}, words_cue("Three", joinsBefore=True)]}), 0)
        self.assertEqual(probe({"hold": [before, {"firstFrame": 30, "endFrame": 45}, {"kind": "caption", "text": "a b", "joinsBefore": True}]}), 0)


@needs_renderer(hf_installed())
class WordsCoverSplitTests(unittest.TestCase):
    """A words state crossing a cover's start or end splits there, so each piece is wholly ink on paper or white on footage."""

    PAPER = {"kind": "paperScene", "start": 1.0, "stop": 2.0}

    def pieces(self, cue, cover=None):
        cover = cover or self.PAPER
        split = probe({"split": [cover, cue]})
        self.assertEqual(split[0], cover)
        return split[1:]

    def spans(self, pieces):
        return [(piece["start"], piece["stop"], piece["joinsBefore"], piece["joinsAfter"]) for piece in pieces]

    def colours(self, pieces):
        return [word_texts(probe({"cue": piece, "cues": [self.PAPER]})["html"])[0][2] for piece in pieces]

    def test_a_state_wholly_inside_or_outside_a_cover_is_unchanged(self):
        for start, stop in ((1.2, 1.5), (2.5, 3.0), (0.2, 1.0), (2.0, 2.4)):
            cue = words_cue("One", start=start, stop=stop)
            self.assertEqual(self.pieces(cue), [cue], (start, stop))

    def test_a_state_entering_a_cover_splits_at_its_start(self):
        pieces = self.pieces(words_cue("Why I", start=0.5, stop=1.5))
        self.assertEqual(self.spans(pieces), [(0.5, 1.0, False, True), (1.0, 1.5, True, False)])
        self.assertEqual(self.colours(pieces), [WHITE, INK])
        self.assertEqual({piece["text"] for piece in pieces}, {"Why I"})

    def test_a_state_leaving_a_cover_splits_at_its_end(self):
        pieces = self.pieces(words_cue("Why", start=1.5, stop=2.5, joinsBefore=True, joinsAfter=True))
        self.assertEqual(self.spans(pieces), [(1.5, 2.0, True, True), (2.0, 2.5, True, True)])
        self.assertEqual(self.colours(pieces), [INK, WHITE])

    def test_a_state_spanning_a_whole_cover_splits_into_three(self):
        pieces = self.pieces(words_cue("One", start=0.5, stop=2.5))
        self.assertEqual(self.spans(pieces), [(0.5, 1.0, False, True), (1.0, 2.0, True, True), (2.0, 2.5, True, False)])
        self.assertEqual(self.colours(pieces), [WHITE, INK, WHITE])

    def test_pieces_keep_the_name_plate_lift_of_their_whole_state(self):
        # The plate meets only the second piece; both pieces must still sit at the one lifted baseline.
        plate = {"kind": "lowerThird", "start": 1.6, "stop": 3.0, "y": 1650}
        pieces = self.pieces(words_cue("One", start=0.5, stop=1.8))
        baselines = {word_texts(probe({"cue": piece, "cues": [self.PAPER, plate]})["html"])[0][1] for piece in pieces}
        self.assertEqual(len(baselines), 1, baselines)
        self.assertLess(baselines.pop(), 1650)

    def test_a_cutaway_splits_at_its_cover_not_its_wipe_out(self):
        cutaway = {"kind": "cutaway", "start": 1.0, "stop": 2.4, "cover": 0.4}
        self.assertEqual(self.spans(self.pieces(words_cue("One", start=1.2, stop=2.0), cutaway)), [(1.2, 1.4, False, True), (1.4, 2.0, True, False)])

    def test_house_captions_are_never_split(self):
        house = {"kind": "caption", "start": 0.5, "stop": 2.5, "text": "House", "joinsBefore": False, "joinsAfter": False}
        self.assertEqual(self.pieces(house), [house])

    def test_the_build_draws_the_split_pieces(self):
        sheet = [{"kind": "paperScene", "at": 1.0, "end": 2.0},
                 {"kind": "caption", "style": "words", "at": 0.5, "end": 1.5, "text": "Why I", "line": "Why I", "pills": []}]
        with tempfile.TemporaryDirectory() as folder:
            work = scratch_work(folder, "cap", make_edl([(0, 120)]), sheet)
            result = build(work, "cap", "--layer", "captions", "--theme", "learning")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(cue_kinds(work, "cap.captions"), ["caption"] * 2)


# House captions keep drawing in the front pass (the zkidz look); only word captions move to the caption layer.
CUES = [
    {"kind": "keyword", "at": 0.2, "end": 1.6, "text": "Card", "tone": "paper"},
    {"kind": "caption", "at": 0.3, "end": 1.5, "text": "House line."},
    {"kind": "caption", "style": "words", "at": 2.0, "end": 2.6, "text": "One", "line": "One two", "pills": []},
    {"kind": "caption", "style": "words", "at": 2.6, "end": 3.2, "text": "One two", "line": "One two", "pills": []},
]
# A line built word by word: the second state lasts 4 frames, so its plate is snapshotted inside its join fade.
WORDS = [
    {"kind": "caption", "style": "words", "at": 0.3, "end": 1.0, "text": "One", "line": "One two", "pills": []},
    {"kind": "caption", "style": "words", "at": 1.0, "end": 1.13, "text": "One two", "line": "One two", "pills": []},
]


@needs_renderer(hf_installed())
class CaptionLayerBuildTests(unittest.TestCase):
    def test_the_front_pass_has_no_words_caption_and_the_caption_pass_only_those(self):
        with tempfile.TemporaryDirectory() as folder:
            work = scratch_work(folder, "cap", make_edl([(0, 120)]), CUES)
            result = build(work, "cap")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(cue_kinds(work, "cap"), ["caption", "keyword"])
            result = build(work, "cap", "--layer", "captions")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(cue_kinds(work, "cap.captions"), ["caption"] * 2)

    def test_the_plates_pass_draws_every_words_state_at_rest(self):
        # caption_layer.py owns the join fade; a plate snapshotted mid-fade would be faded twice.
        script = "const { build } = require(process.argv[1]); build('words', { layer: 'captions', plates: true, theme: 'learning' });"
        with tempfile.TemporaryDirectory() as folder:
            work = scratch_work(folder, "words", make_edl([(0, 60)]), WORDS)
            result = subprocess.run(["node", "-e", script, str(ENGINE / "hf" / "build.js")], cwd=work, capture_output=True, text=True,
                                    encoding="utf-8", env={**os.environ, "ZKS_WORK": str(work)}, timeout=120)
            self.assertEqual(result.returncode, 0, result.stderr)
            plates = tweens((work / "hf" / "words.captions.plates" / "index.html").read_text(encoding="utf-8"))
        self.assertEqual([spec for spec in plates if spec["target"].endswith(".plate")], [])

    def test_stills_draw_words_captions_in_front(self):
        script = "const { build } = require(process.argv[1]); build('words', { variant: 'stills', theme: 'learning' });"
        with tempfile.TemporaryDirectory() as folder:
            work = scratch_work(folder, "words", make_edl([(0, 60)]), WORDS)
            result = subprocess.run(["node", "-e", script, str(ENGINE / "hf" / "build.js")], cwd=work, capture_output=True, text=True,
                                    encoding="utf-8", env={**os.environ, "ZKS_WORK": str(work)}, timeout=120)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(cue_kinds(work, "words.stills"), ["caption"] * 2)


@needs_renderer(hf_installed())
class CaptionLayerSheetTests(unittest.TestCase):
    """render.js's caption-layer motion as caption_layer.py reads it from frames/<v>.cc.json."""

    def test_a_first_state_rises_then_fades_and_ends_at_rest_between(self):
        cue = words_cue("One", start=30 / FPS, stop=90 / FPS)
        motion = probe({"motion": [cue, {"firstFrame": 30, "endFrame": 90}, FPS]})
        frames = [frame for frame, *_ in motion]
        self.assertEqual(frames[0], 30)
        self.assertGreater(motion[0][2], 0, "it starts lower and rises")
        self.assertEqual(frames[-1], 89, "the fade ends on its last frame")
        self.assertTrue(all(0 <= alpha <= 1 for _, alpha, _ in motion))


if __name__ == "__main__":
    unittest.main()
