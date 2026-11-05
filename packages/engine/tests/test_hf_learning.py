# Created by The Angelo Umali.
# The learning-vlog kinds (hf/components/learning/), drawn on hf/learning/tokens.js only, plus the shared cover helper
# (hf/learning/cover.js) that turns a words caption ink on paper, and their builds in the learning theme. Needs node only.
import json
import math
import re
from html import unescape
import subprocess
import tempfile
import unittest

from support import ENGINE, hf_installed, make_edl, needs_renderer, scratch_work  # first: it sets a scratch ZKS_HOME
from test_hf_bridge import assert_seek_safe, build as build_any, tweens
from test_hf_learning_captions import probe as caption_probe, word_texts, words_cue
from zks_engine import sfx


def build(work, target, *args):
    """build.js in the learning theme, the only one that draws these kinds."""
    return build_any(work, target, *args, "--theme", "learning")

# Runs {cue, cues} through REGISTRY[cue.kind] (cue start 1, stop 3 unless given) and prints render + sfx as JSON;
# {cover: [cue, cues]} runs cover.js onCover; {columns: [values, options]} runs odometer.js odometerColumns.
PROBE = """
const path = require("path");
const input = JSON.parse(require("fs").readFileSync(0, "utf8"));
const hf = path.join(process.argv[1], "hf");
let out;
if (input.cover) out = require(path.join(hf, "learning", "cover.js")).onCover(...input.cover);
else if (input.columns) out = require(path.join(hf, "components", "learning", "odometer.js")).odometerColumns(...input.columns);
else {
  const { REGISTRY } = require(path.join(hf, "components"));
  const cue = { seed: 9001, start: 1, stop: 3, ...input.cue };
  const duration = cue.stop - cue.start;
  const kind = REGISTRY[cue.kind];
  const drawn = kind.render(cue, { id: "c0", duration, cues: input.cues ?? [cue], fps: 30000 / 1001 });
  out = { ...drawn, sfx: kind.sfx(cue, duration), track: kind.track ?? 2 };
}
console.log(JSON.stringify(out));
"""
# The learning tokens: paper, navy ink, gold accent and rules; accent text is orange.
PAPER, INK, ACCENT, ACCENT_INK, WHITE = "#F3EFE8", "#172230", "#C9A838", "#EA580C", "#FFFFFF"
SAND, GOLD_TOP = "#D8CDB6", "#E2C766"  # the gauge's middle zone and a gold level's lit top (tokens.js shade)
RULE = ACCENT
# The learning riser's recipe lands with the sfx.py port (#38); until then it is the one name allowed without one.
KNOWN_SOUNDS = set(sfx.RECIPES) | {"riser"}
TEXT = re.compile(r'<text [^>]*style="white-space:pre"[^>]*>([^<]*)</text>')


def probe(payload):
    result = subprocess.run(["node", "-e", PROBE, str(ENGINE)], capture_output=True, text=True, encoding="utf-8", input=json.dumps(payload))
    if result.returncode:
        raise AssertionError(result.stderr)
    return json.loads(result.stdout)


def render(**cue):
    return probe({"cue": cue})


def specs(drawn, target=None):
    every = [*drawn["motion"], *drawn["exit"]]
    return [spec for spec in every if target is None or spec["target"] == target]


def texts(html):
    return [unescape(text) for text in TEXT.findall(html)]


def fills_of_texts(html):
    return re.findall(r'<text [^>]*fill="([^"]+)"[^>]*style="white-space:pre"', html)


class SoundsAndSeeksMixin:
    def assert_sound_and_seek_safe(self, drawn):
        assert_seek_safe(self, specs(drawn))
        self.assertFalse({event["sound"] for event in drawn["sfx"]} - KNOWN_SOUNDS)


@needs_renderer(hf_installed())
class CoverTests(unittest.TestCase):
    def test_a_cutaway_covers_its_cover_span_and_a_paper_scene_its_whole_span(self):
        cue = {"kind": "caption", "start": 1.0, "stop": 1.5}
        cutaway = {"kind": "cutaway", "start": 0.5, "stop": 2.4, "cover": 0.4}
        paper = {"kind": "paperScene", "start": 0.5, "stop": 2.4}
        self.assertFalse(probe({"cover": [cue, [cutaway]]}))
        self.assertTrue(probe({"cover": [cue, [paper]]}))
        self.assertFalse(probe({"cover": [{**cue, "start": 2.4}, [paper]]}), "the end is exclusive")
        self.assertFalse(probe({"cover": [cue, [{**paper, "kind": "keyword"}]]}))

    def test_a_words_caption_starting_inside_a_paper_scene_is_ink(self):
        paper = {"kind": "paperScene", "start": 0.5, "stop": 2.4}
        html = caption_probe({"cue": words_cue("One"), "cues": [paper]})["html"]
        self.assertEqual(word_texts(html)[0][2], INK)
        self.assertNotIn("feDropShadow", html)
        later = caption_probe({"cue": words_cue("One", start=2.5, stop=3.0), "cues": [paper]})["html"]
        self.assertEqual(word_texts(later)[0][2], WHITE)


@needs_renderer(hf_installed())
class PaperSceneTests(SoundsAndSeeksMixin, unittest.TestCase):
    def test_a_full_frame_opaque_cream_sheet_with_a_dot_grid_and_a_warm_glow(self):
        drawn = render(kind="paperScene")
        html = drawn["html"]
        self.assertIn('class="box sheet" style="left:0px;top:0px;width:1080px;height:1920px"', html)
        self.assertIn(f'width="1080" height="1920" fill="{PAPER}"', html)
        self.assertIn("<pattern", html)
        self.assertIn("<radialGradient", html)
        self.assertEqual(drawn["track"], 4)
        self.assertEqual(texts(html), [], "no label, no words")

    def test_the_z_logo_draws_on_once_the_sheet_lands(self):
        drawn = render(kind="paperScene", logo={"y": 260, "height": 140})
        self.assertIn('class="z-steel"', drawn["html"])
        self.assertIn('class="z-gold"', drawn["html"])
        steel, gold = specs(drawn, ".z-steel"), specs(drawn, ".z-gold")
        self.assertTrue(steel and gold)
        self.assertGreaterEqual(steel[0]["at"], 0.2, "after the 0.2 s slide")
        self.assertGreater(gold[0]["at"], steel[0]["at"])
        self.assert_sound_and_seek_safe(drawn)
        self.assertNotIn("z-steel", render(kind="paperScene")["html"])

    def test_enter_up_and_exit_up_slide_and_hold_still_between(self):
        drawn = render(kind="paperScene")
        enter, leave = specs(drawn, ".sheet")
        self.assertEqual((enter["at"], enter["from"], enter["to"]["y"]), (0, {"y": 1920}, 0))
        self.assertAlmostEqual(enter["to"]["duration"], 0.2)
        self.assertAlmostEqual(leave["at"], 1.8)
        self.assertEqual((leave["from"], leave["to"]["y"], leave["to"]["immediateRender"]), ({"y": 0}, -1920, False))
        self.assertNotIn("linear", json.dumps(drawn), "no linear easing")
        self.assert_sound_and_seek_safe(drawn)

    def test_left_enter_and_right_and_down_exits(self):
        enter, leave = specs(render(kind="paperScene", enter="left", exit="right"), ".sheet")
        self.assertEqual((enter["from"], enter["to"]["x"]), ({"x": -1080}, 0))
        self.assertEqual((leave["from"], leave["to"]["x"]), ({"x": 0}, 1080))
        _, down = specs(render(kind="paperScene", exit="down"), ".sheet")
        self.assertEqual(down["to"]["y"], 1920)

    def test_each_slide_carries_a_gold_rule_edge_and_whooshes(self):
        drawn = render(kind="paperScene")
        self.assertIn(f'fill="{RULE}"', drawn["html"])
        self.assertTrue(specs(drawn, ".edge-in") and specs(drawn, ".edge-out"))
        self.assertEqual([(event["at"], event["sound"]) for event in drawn["sfx"]], [(0, "swish"), (1.8, "whipOut")])

    def test_cut_has_no_slide_no_edge_and_no_sound(self):
        drawn = render(kind="paperScene", enter="cut", exit="cut")
        self.assertEqual(specs(drawn), [])
        self.assertEqual(drawn["sfx"], [])
        self.assertNotIn("edge-in", drawn["html"])

    def test_a_scene_shorter_than_its_slides_shares_its_span_between_them(self):
        enter, leave = specs(render(kind="paperScene", start=1.0, stop=1.3), ".sheet")
        self.assertLessEqual(enter["to"]["duration"] + leave["to"]["duration"], 0.3 + 1e-9)
        self.assertGreaterEqual(leave["at"], enter["to"]["duration"] - 1e-9)
        self.assertAlmostEqual(leave["at"] + leave["to"]["duration"], 0.3)

    def test_an_unknown_direction_is_refused(self):
        with self.assertRaisesRegex(AssertionError, "sideways"):
            render(kind="paperScene", enter="sideways")

    def test_the_label_is_a_mono_caps_kicker_placed_by_its_fields(self):
        html = render(kind="paperScene", label="— input", labelX=200, labelY=400)["html"]
        self.assertEqual(texts(html), ["— INPUT"])
        self.assertIn('font-family="JetBrains Mono"', html)
        self.assertRegex(html, r'<text x="200" y="400"')


@needs_renderer(hf_installed())
class BigWordTests(SoundsAndSeeksMixin, unittest.TestCase):
    def test_huge_chakra_petch_bold_drawing_only_its_text(self):
        drawn = render(kind="bigWord", text="BIG")
        self.assertIn('font-family="Chakra Petch" font-weight="700" font-size="240"', drawn["html"])
        self.assertEqual("".join(texts(drawn["html"])), "BIG")
        self.assert_sound_and_seek_safe(drawn)

    def test_white_on_footage_ink_on_paper_or_its_own_colour(self):
        paper = {"kind": "paperScene", "start": 0.5, "stop": 4}
        self.assertEqual(set(fills_of_texts(render(kind="bigWord", text="AI")["html"])), {WHITE})
        on_paper = probe({"cue": {"kind": "bigWord", "text": "AI"}, "cues": [paper]})["html"]
        self.assertEqual(set(fills_of_texts(on_paper)), {INK})
        self.assertEqual(set(fills_of_texts(render(kind="bigWord", text="AI", color=ACCENT)["html"])), {ACCENT})

    def test_a_kicker_chip_sits_above_the_word_and_no_plate_is_ever_drawn(self):
        html = render(kind="bigWord", text="GRAPHICS", plate="accent", kicker="effects applied", size=120)["html"]
        self.assertNotIn('class="u plate"', html, "the v2 rules ban backdrops behind words")
        self.assertEqual(texts(html)[0], "EFFECTS APPLIED")
        self.assertIn('font-family="JetBrains Mono"', html)
        self.assertEqual("".join(texts(html)[1:]), "GRAPHICS")
        self.assertEqual(set(fills_of_texts(html)[1:]), {WHITE})

    def test_drop_letters_fall_in_one_by_one_and_the_riser_lands_with_the_last(self):
        drawn = render(kind="bigWord", text="POSSIBLE", size=180, drop=True)
        falls = [spec for spec in drawn["motion"] if re.fullmatch(r"\.l\d+", spec["target"]) and "y" in spec["from"]]
        self.assertEqual(len(falls), 8)
        self.assertTrue(all(spec["from"]["y"] < 0 for spec in falls))
        self.assertEqual(sorted(spec["at"] for spec in falls), [spec["at"] for spec in falls])
        riser, = [event for event in drawn["sfx"] if event["sound"] == "riser"]
        self.assertGreater(riser["at"], falls[-1]["at"])
        self.assert_sound_and_seek_safe(drawn)

    def test_tumble_letters_fly_in_rotating_from_the_cue_seed(self):
        drawn = render(kind="bigWord", text="MOTION", tumble=True)
        spins = [spec for spec in drawn["motion"] if "rotation" in spec["from"]]
        self.assertEqual(len(spins), 6)
        self.assertTrue(all(spec["from"]["rotation"] != 0 and spec["to"]["rotation"] == 0 for spec in spins))
        self.assertEqual(drawn, render(kind="bigWord", text="MOTION", tumble=True))
        self.assertNotEqual(spins, [spec for spec in render(kind="bigWord", text="MOTION", tumble=True, seed=9002)["motion"] if "rotation" in spec["from"]])
        self.assert_sound_and_seek_safe(drawn)

    def test_odometer_columns_roll_from_value_to_value_with_blank_leading_zeros(self):
        digits = lambda *args: [column["digits"] for column in probe({"columns": list(args)})]
        self.assertEqual(digits([99, 100], {}), [["", "1"], ["9", "0"], ["9", "0"]])
        self.assertEqual(digits([1, 5, 3], {"pad": 2}), [["0"], ["1", "2", "3", "4", "5"]])
        self.assertEqual(probe({"columns": [[1, 5, 3], {"pad": 2}]})[1]["rows"], [0, 4, 2])
        self.assertEqual(digits([995, 1000], {"decimals": 1}), [["", "1"], ["9", "0"], ["9", "0"], ["5", "6", "7", "8", "9", "0"]])

    def test_a_long_count_keeps_each_strip_short(self):
        units = probe({"columns": [[0, 1000000], {}]})[-1]
        self.assertEqual(len(units["digits"]), 30)
        self.assertEqual((units["digits"][0], units["digits"][-1], units["rows"]), ("0", "0", [0, 29]))
        drawn = render(kind="bigWord", size=100, count={"from": 0, "to": 1000000})
        self.assertLessEqual(drawn["html"].count("<text"), 7 * 30)

    def test_a_capped_strip_still_lands_every_step_on_its_digit(self):
        # 0 → 5 → 100 spans 101 units rows; a strip cut to its last 30 rows showed 0 while the figure held at 5.
        for values in ([0, 5, 100], [0, 50, 1000, 7], [3, 999, 4]):
            columns = probe({"columns": [values, {}]})
            for step, value in enumerate(values):
                shown = "".join(column["digits"][column["rows"][step]] for column in columns)
                self.assertEqual(shown, str(value), (values, step))
            self.assertTrue(all(len(column["digits"]) <= 30 for column in columns), values)

    def test_count_rolls_to_its_value_on_count_at_and_lands_the_riser(self):
        drawn = render(kind="bigWord", count={"from": 99, "to": 100, "suffix": "%"}, countAt=0.4)
        rolls = [spec for spec in drawn["motion"] if ".roll" in spec["target"] and "y" in spec["to"]]
        self.assertEqual(len(rolls), 3)
        self.assertEqual({spec["at"] for spec in rolls}, {0.4})
        self.assertTrue(all(spec["to"]["y"] < 0 and spec["to"]["immediateRender"] is False for spec in rolls))
        self.assertIn("%", texts(drawn["html"]))
        riser, = [event for event in drawn["sfx"] if event["sound"] == "riser"]
        self.assertAlmostEqual(riser["at"], 0.4 + rolls[0]["to"]["duration"])
        self.assert_sound_and_seek_safe(drawn)

    def test_a_count_from_its_own_value_stands_still(self):
        drawn = render(kind="bigWord", count={"from": 7, "to": 7})
        self.assertFalse([spec for spec in drawn["motion"] if ".roll" in spec["target"]])
        self.assertFalse([event for event in drawn["sfx"] if event["sound"] == "riser"])

    def test_steps_roll_on_their_pins_in_time_order_and_drop_pins_past_the_end(self):
        drawn = render(kind="bigWord", pad=2, steps=[{"at": 1.2, "to": 5}, {"at": 0.4, "to": 2}, {"at": 2.5, "to": 9}])
        units = [spec for spec in drawn["motion"] if spec["target"] == '.roll[data-col="1"]']
        self.assertEqual([spec["at"] for spec in units], [0.4, 1.2])
        self.assertLess(units[1]["to"]["y"], units[0]["to"]["y"])
        self.assertEqual(units[1]["from"]["y"], units[0]["to"]["y"], "each step starts where the last one landed")
        self.assertEqual([event["at"] for event in drawn["sfx"] if event["sound"] == "tick"], [0.4, 1.2])
        self.assert_sound_and_seek_safe(drawn)

    def test_text_wider_than_the_frame_is_refused_by_name(self):
        with self.assertRaisesRegex(AssertionError, "WWWWWWWW"):
            render(kind="bigWord", text="WWWWWWWW")
        with self.assertRaisesRegex(AssertionError, "1000000000"):
            render(kind="bigWord", count={"from": 0, "to": 1000000000})

    def test_the_default_entrance_rises_out_of_a_blur_and_hit_adds_the_hook(self):
        drawn = render(kind="bigWord", text="AI", hit=True)
        alpha = [spec for spec in drawn["motion"] if spec["target"] == ".word" and "opacity" in spec["from"]]
        self.assertIn("blur", alpha[0]["from"]["filter"])
        self.assertIn("hook", [event["sound"] for event in drawn["sfx"]])
        self.assertTrue([spec for spec in drawn["exit"] if spec["target"] == ".word"])

    def test_one_motion_at_a_time(self):
        with self.assertRaisesRegex(AssertionError, "one motion"):
            render(kind="bigWord", text="AI", drop=True, tumble=True)


@needs_renderer(hf_installed())
class ChipRailTests(SoundsAndSeeksMixin, unittest.TestCase):
    CHIPS = [{"text": "final edit", "at": 0.2, "tone": "accent"}, {"text": "graded", "at": 0.5, "tone": "ink"}, {"text": "9:16", "at": 0.8, "tone": "ghost"}]

    def chip_rects(self, html):
        return [(float(x), float(w)) for x, w in re.findall(r'<rect class="chip-plate" x="([\d.-]+)" y="[\d.-]+" width="([\d.]+)"', html)]

    def test_mono_caps_chips_in_their_tones(self):
        drawn = render(kind="chipRail", chips=self.CHIPS, x=80, y=300)
        html = drawn["html"]
        self.assertEqual(texts(html), ["FINAL EDIT", "GRADED", "9:16"])
        self.assertIn('font-family="JetBrains Mono"', html)
        self.assertEqual(fills_of_texts(html), [INK, PAPER, INK], "navy on the gold chip")
        self.assertIn(f'fill="{ACCENT}"', html)
        self.assertIn(f'fill="{INK}"', html)
        self.assert_sound_and_seek_safe(drawn)

    def test_the_retired_rust_tone_is_refused_by_name(self):
        with self.assertRaisesRegex(AssertionError, "final edit"):
            render(kind="chipRail", chips=[{"text": "final edit", "at": 0, "tone": "rust"}])

    def test_chips_pop_on_their_pins_with_a_tick_each(self):
        drawn = render(kind="chipRail", chips=self.CHIPS)
        pops = [spec for spec in drawn["motion"] if spec["target"].startswith(".chip")]
        self.assertEqual([spec["at"] for spec in pops], [0.2, 0.5, 0.8])
        self.assertTrue(all(spec["from"] == {"scale": 0.85, "opacity": 0} and spec["to"]["duration"] == 0.12 for spec in pops))
        self.assertEqual([(event["at"], event["sound"]) for event in drawn["sfx"]], [(0.2, "tick"), (0.5, "tick"), (0.8, "tick")])

    def test_one_row_with_fixed_gaps_left_or_centred(self):
        left = self.chip_rects(render(kind="chipRail", chips=self.CHIPS, x=80)["html"])
        self.assertEqual(left[0][0], 80)
        gaps = {round(nxt[0] - (cur[0] + cur[1]), 3) for cur, nxt in zip(left, left[1:])}
        self.assertEqual(len(gaps), 1)
        centred = self.chip_rects(render(kind="chipRail", chips=self.CHIPS, align="center", x=540)["html"])
        self.assertAlmostEqual((centred[0][0] + centred[-1][0] + centred[-1][1]) / 2, 540, places=3)

    def test_a_single_chip_and_chips_on_one_pin(self):
        one = render(kind="chipRail", chips=[{"text": "zoom 120%", "at": 0.3}])
        self.assertEqual(texts(one["html"]), ["ZOOM 120%"])
        same = render(kind="chipRail", chips=[{"text": "raw", "at": 0.3}, {"text": "ungraded", "at": 0.3}])
        self.assertEqual([spec["at"] for spec in same["motion"] if spec["target"].startswith(".chip")], [0.3, 0.3])
        self.assertEqual([event["at"] for event in same["sfx"]], [0.3], "one tick per moment, not a doubled one")

    def test_a_row_wider_than_the_frame_is_refused_by_name(self):
        with self.assertRaisesRegex(AssertionError, "GET THE PROMPTS"):
            render(kind="chipRail", chips=[{"text": "get the prompts + the full setup and more", "at": 0}], size=60)



TERMINAL, BAD = "#10100C", "#C8322F"
POLY_RIGHT = re.compile(r"polygon\([\d.-]+px [\d.-]+px, ([\d.-]+)px")


def keyframes_end(spec):
    return spec["at"] + sum(frame.get("duration", 0) for frame in spec["to"]["keyframes"])


def sounds(drawn):
    return [(round(event["at"], 4), event["sound"]) for event in drawn["sfx"]]


@needs_renderer(hf_installed())
class TypedPromptTests(SoundsAndSeeksMixin, unittest.TestCase):
    CUE = {"kind": "typedPrompt", "text": "Edit a 9:16 video", "typeAt": 0.4, "output": ["reading clips", "cutting pauses"], "outputAt": 1.4}

    def test_a_near_black_terminal_card_drawing_only_its_own_words(self):
        drawn = render(**self.CUE)
        html = drawn["html"]
        self.assertEqual(texts(html), ["terminal", ">", "Edit a 9:16 video", "reading clips", "cutting pauses"])
        self.assertIn(f'fill="{TERMINAL}"', html)
        self.assertIn(f'fill="{ACCENT}"', html, "the header dot")
        self.assertIn('font-family="JetBrains Mono"', html)
        self.assert_sound_and_seek_safe(drawn)

    def test_the_prompt_types_from_type_at_at_cps_under_one_type_span(self):
        drawn = render(**self.CUE, cps=20)
        reveal, = specs(drawn, ".tp-line0")
        self.assertEqual(reveal["at"], 0.4)
        frames = reveal["to"]["keyframes"]
        self.assertEqual(len(frames), 1 + len("Edit a 9:16 video"))
        self.assertTrue(all(abs(frame["duration"] - 1 / 20) < 1e-9 and frame["ease"] == "steps(1)" for frame in frames[1:]))
        typing, = [event for event in drawn["sfx"] if event["sound"] == "type"]
        self.assertEqual(typing["at"], 0.4)
        self.assertAlmostEqual(typing["dur"], len("Edit a 9:16 video") / 20)

    def test_the_block_cursor_blinks_on_one_stepped_track(self):
        drawn = render(**self.CUE)
        blink = [spec for spec in specs(drawn, ".tp-cursor") if any("opacity" in frame for frame in spec["to"].get("keyframes", []))]
        self.assertEqual(len(blink), 1)
        values = {frame["opacity"] for frame in blink[0]["to"]["keyframes"]}
        self.assertEqual(values, {0, 1})
        self.assertEqual(blink[0]["at"], 0)

    def test_output_lines_arrive_blurred_from_output_at_and_scroll_up(self):
        output = [f"agent line {index}" for index in range(8)]
        drawn = render(**{**self.CUE, "output": output}, stop=5)
        arrivals = [spec for spec in drawn["motion"] if re.fullmatch(r"\.tp-out\d+", spec["target"])]
        self.assertEqual(len(arrivals), 8)
        self.assertTrue(all(spec["at"] >= 1.4 for spec in arrivals))
        self.assertEqual(sorted(spec["at"] for spec in arrivals), [spec["at"] for spec in arrivals])
        self.assertIn("feGaussianBlur", drawn["html"])
        scroll, = specs(drawn, ".tp-scroll")
        self.assertLess(min(frame.get("y", 0) for frame in scroll["to"]["keyframes"]), 0)
        self.assert_sound_and_seek_safe(drawn)

    def test_text_longer_than_the_card_wraps_by_mono_columns_inside_it(self):
        text = "Edit a 9:16 short-form video for Instagram and TikTok using HyperFrames and every skill you have"
        drawn = render(kind="typedPrompt", text=text, x=150, w=780, stop=8)
        lines = [line for line in texts(drawn["html"]) if line not in ("terminal", ">")]
        self.assertGreater(len(lines), 1)
        self.assertEqual(" ".join(lines), text)
        for index in range(len(lines)):
            reveal, = specs(drawn, f".tp-line{index}")
            right = float(POLY_RIGHT.search(reveal["to"]["keyframes"][-1]["clipPath"]).group(1))
            self.assertLessEqual(right, 150 + 780 - 30 + 1e-6)

    def test_typing_pinned_too_late_to_finish_types_faster_to_land_before_the_exit(self):
        drawn = render(kind="typedPrompt", text="a long prompt that cannot finish at thirty a second", typeAt=1.2)
        reveal, = specs(drawn, ".tp-line0")
        self.assertLessEqual(keyframes_end(reveal), 2 - 0.2 + 1e-9)
        typing, = [event for event in drawn["sfx"] if event["sound"] == "type"]
        self.assertLessEqual(typing["at"] + typing["dur"], 1.8 + 1e-9)
        with self.assertRaisesRegex(AssertionError, "typedPrompt.*typeAt"):
            render(kind="typedPrompt", text="too late", typeAt=1.9)

    def test_a_card_past_the_safe_band_is_refused_by_name(self):
        with self.assertRaisesRegex(AssertionError, "typedPrompt.*1330"):
            render(kind="typedPrompt", text="low", y=1200)

    def test_deterministic(self):
        self.assertEqual(render(**self.CUE), render(**self.CUE))


@needs_renderer(hf_installed())
class AskFieldTests(SoundsAndSeeksMixin, unittest.TestCase):
    CUE = {"kind": "askField", "label": "— one message", "placeholder": "Ask for any change…", "text": "Make the captions bigger",
           "typeAt": 0.3, "sendAt": 1.4,
           "status": [{"at": 1.7, "text": "Claude is editing…"}, {"at": 2.4, "text": "Captions · 140% · applied", "ok": True}]}

    def test_draws_only_its_own_words(self):
        drawn = render(**self.CUE, stop=4)
        self.assertEqual(texts(drawn["html"]), ["— ONE MESSAGE", "Ask for any change…", "Make the captions bigger", "Make the captions bigger",
                                                "CLAUDE IS EDITING…", "CAPTIONS · 140% · APPLIED"])
        self.assertIn('font-family="Inter"', drawn["html"])
        self.assert_sound_and_seek_safe(drawn)

    def test_the_send_button_turns_accent_on_the_first_letter(self):
        drawn = render(**self.CUE, stop=4)
        self.assertIn(f'fill="{ACCENT}"', drawn["html"])
        lit, = specs(drawn, ".af-send-on")
        self.assertAlmostEqual(lit["at"], 0.3 + 1 / 30)
        gone, = specs(drawn, ".af-placeholder")
        self.assertAlmostEqual(gone["at"], 0.3)

    def test_send_clears_the_field_and_flies_the_message_up_into_a_dark_bubble(self):
        drawn = render(**self.CUE, stop=4)
        cleared = [spec for spec in specs(drawn, ".af-text") if spec["at"] == 1.4]
        self.assertEqual(cleared[0]["to"]["opacity"], 0)
        flights = [spec for spec in specs(drawn, ".af-bubble") if "y" in spec.get("from", {})]
        self.assertEqual(flights[0]["at"], 1.4)
        self.assertGreater(flights[0]["from"]["y"], 0)
        self.assertEqual(flights[0]["to"]["y"], 0)
        self.assertIn(f'fill="{INK}"', drawn["html"])
        self.assertIn((1.4, "swish"), sounds(drawn))

    def test_statuses_replace_each_other_and_an_ok_one_checks_in_accent(self):
        drawn = render(**self.CUE, stop=4)
        first = specs(drawn, ".af-status0")
        self.assertEqual([spec["at"] for spec in first], [1.7, 2.4])
        self.assertEqual(first[1]["to"]["opacity"], 0)
        self.assertIn('class="af-check"', drawn["html"])
        self.assertIn(f'stroke="{ACCENT_INK}"', drawn["html"].split('class="af-check"')[1][:300])
        self.assertEqual([at for at, sound in sounds(drawn) if sound == "check"], [2.4])
        self.assertEqual([sound for _, sound in sounds(drawn)], ["type", "swish", "check"])

    def test_no_status_and_no_send(self):
        drawn = render(kind="askField", text="Hi", typeAt=0.2)
        self.assertEqual(texts(drawn["html"]), ["Ask for any change…", "Hi"])
        self.assertEqual([sound for _, sound in sounds(drawn)], ["type"])
        self.assertNotIn("af-bubble", drawn["html"])
        self.assert_sound_and_seek_safe(drawn)

    def test_a_status_pinned_before_the_send_is_refused_by_name(self):
        with self.assertRaisesRegex(AssertionError, "EARLY"):
            render(**{**self.CUE, "status": [{"at": 1.0, "text": "early"}]}, stop=4)

    def test_text_wider_than_the_field_is_refused_by_name(self):
        with self.assertRaisesRegex(AssertionError, "askField.*Make the captions"):
            render(kind="askField", text="Make the captions bigger and bolder and steel and centred and animated", typeAt=0.1, stop=6)


@needs_renderer(hf_installed())
class CommentCtaTests(SoundsAndSeeksMixin, unittest.TestCase):
    CUE = {"kind": "commentCta", "lead": "Comment", "word": "CLAUDE", "sub": "Get the prompts + the full setup"}

    def test_draws_only_its_own_words_in_its_faces(self):
        drawn = render(**self.CUE)
        html = drawn["html"]
        self.assertEqual(texts(html), ["Comment", *"CLAUDE", "GET THE PROMPTS + THE FULL SETUP"])
        self.assertIn('font-family="Chakra Petch" font-weight="600"', html)
        self.assertIn('font-family="Chakra Petch" font-weight="700"', html)
        self.assertEqual(fills_of_texts(html)[1:7], [INK] * 6, "navy letters rise into the gold")
        self.assertEqual(fills_of_texts(html)[0], INK)
        self.assert_sound_and_seek_safe(drawn)

    def test_the_outline_draws_on_then_fills_accent_then_the_letters_rise_in_order(self):
        drawn = render(**self.CUE, bubbleAt=0.4, wordAt=0.8, subAt=1.4)
        outline, = specs(drawn, ".cta-outline")
        self.assertEqual((outline["at"], outline["from"]["attr"]["stroke-dashoffset"], outline["to"]["attr"]["stroke-dashoffset"]), (0.4, 1, 0))
        fill, = specs(drawn, ".cta-fill")
        self.assertGreater(fill["at"], 0.4)
        self.assertLessEqual(fill["at"], 0.8)
        self.assertIn(f'fill="{ACCENT}"', drawn["html"])
        rises = [spec for spec in drawn["motion"] if re.fullmatch(r"\.cta-l\d", spec["target"]) and "y" in spec["from"]]
        self.assertEqual(len(rises), 6)
        self.assertEqual(rises[0]["at"], 0.8)
        self.assertEqual(sorted(spec["at"] for spec in rises), [spec["at"] for spec in rises])
        self.assertTrue(all(spec["from"]["y"] > 0 for spec in rises))
        hook, = [at for at, sound in sounds(drawn) if sound == "hook"]
        self.assertGreater(hook, rises[-1]["at"])
        self.assertEqual([at for at, sound in sounds(drawn) if sound == "tick"], [0, 1.4])

    def test_default_pins_are_staggered_and_no_sub_has_no_chip(self):
        drawn = render(kind="commentCta", lead="Comment", word="CLAUDE")
        outline, = specs(drawn, ".cta-outline")
        rises = [spec for spec in drawn["motion"] if spec["target"] == ".cta-l0" and "y" in spec["from"]]
        self.assertLess(0, outline["at"])
        self.assertLess(outline["at"], rises[0]["at"])
        self.assertNotIn("chip-plate", drawn["html"])
        self.assertEqual([sound for _, sound in sounds(drawn)], ["tick", "hook"])

    def test_a_word_wider_than_the_frame_is_refused_by_name(self):
        with self.assertRaisesRegex(AssertionError, "commentCta.*SUBSCRIBERS"):
            render(kind="commentCta", lead="Comment", word="SUBSCRIBERS")


RECEIPT = {"kind": "receipt", "start": 1, "stop": 6,
           "input": {"clips": [{"label": "clip 1", "seconds": 56.8}, {"label": "clip 2", "seconds": 12.3}, {"label": "clip 3", "seconds": 128.3}],
                     "seconds": 197.4},
           "removed": [{"start": 10.0, "end": 20.0, "why": "bad"}, {"start": 30.0, "end": 31.0, "why": "pause"}, {"start": 100.0, "end": 110.0, "why": "bad"}],
           "output": 176.4, "badAt": 1.4, "pausesAt": 2.0, "collapseAt": 3.0}


def rects(html, fill):
    return [(float(x), float(w)) for x, w in re.findall(rf'<rect x="([\d.-]+)" y="[\d.-]+" width="([\d.]+)" height="[\d.]+"[^>]*fill="{fill}"', html)]


@needs_renderer(hf_installed())
class ReceiptTests(SoundsAndSeeksMixin, unittest.TestCase):
    def test_draws_only_its_own_numbers_and_labels(self):
        drawn = probe({"cue": RECEIPT})
        words = texts(drawn["html"])
        for word in ("— INPUT", "— OUTPUT", "clip 1 0:56.8", "clip 2 0:12.3", "clip 3 2:08.3", "kept", "bad takes", "pauses", "0:00.0", "3:17.4", "2:56.4"):
            self.assertIn(word, words)
        self.assertEqual(words.count("2:56.4"), 1, "the final number is drawn once, in the accent")
        self.assertIn('font-family="Chakra Petch" font-weight="700"', drawn["html"])
        self.assert_sound_and_seek_safe(drawn)

    def test_the_counter_counts_up_then_down_and_lands_accent_on_a_hook(self):
        drawn = probe({"cue": RECEIPT})
        strip, = specs(drawn, ".rc-strip")
        ys = [frame["y"] for frame in strip["to"]["keyframes"]]
        self.assertEqual(ys, sorted(ys, reverse=True), "the strip only ever steps on")
        self.assertRegex(drawn["html"], rf'fill="{ACCENT_INK}"[^>]*style="white-space:pre">2:56.4<')
        counts = [event for event in drawn["sfx"] if event["sound"] == "count"]
        self.assertEqual(len(counts), 2)
        self.assertTrue(all(event["dur"] > 0 for event in counts))
        self.assertEqual(counts[1]["at"], 3.0)
        hook, = [event["at"] for event in drawn["sfx"] if event["sound"] == "hook"]
        self.assertAlmostEqual(hook, keyframes_end(strip))
        self.assertEqual([event["at"] for event in drawn["sfx"] if event["sound"] == "tick"], [1.4, 2.0])

    def test_stripes_sit_at_their_fraction_of_the_input_and_land_on_their_pins(self):
        drawn = probe({"cue": RECEIPT})
        bad = rects(drawn["html"], BAD)
        self.assertEqual(len(bad), 2)
        self.assertAlmostEqual(bad[0][0], 150 + 10 / 197.4 * 780, places=2)
        self.assertAlmostEqual(bad[0][1], 10 / 197.4 * 780, places=2)
        self.assertEqual(len(rects(drawn["html"], "#FFFFFF")), 1)
        self.assertEqual(specs(drawn, ".rc-bad")[0]["at"], 1.4)
        self.assertEqual(specs(drawn, ".rc-pause")[0]["at"], 2.0)

    def test_the_stripes_collapse_into_packed_kept_blocks(self):
        drawn = probe({"cue": RECEIPT})
        slides = [spec for spec in drawn["motion"] if re.fullmatch(r"\.rc-kept\d+", spec["target"]) and "x" in spec["to"]]
        self.assertEqual(len(slides), 4)
        self.assertTrue(all(spec["at"] >= 3.0 for spec in slides))
        self.assertEqual(slides[0]["to"]["x"], 0, "the first kept block already sits at the left")
        self.assertTrue(all(spec["to"]["x"] < 0 for spec in slides[1:]))

    def test_one_clip_and_no_removals_stand_still_and_land_on_the_input(self):
        cue = {**RECEIPT, "input": {"clips": [{"label": "clip 1", "seconds": 33.6}], "seconds": 33.6}, "removed": [], "output": 33.6}
        drawn = probe({"cue": cue})
        words = texts(drawn["html"])
        self.assertNotIn("bad takes", words)
        self.assertNotIn("pauses", words)
        self.assertEqual(words.count("0:33.6"), 2, "the count-up lands on the input before the accent final")
        self.assertEqual(rects(drawn["html"], BAD), [])
        self.assertEqual([event["sound"] for event in drawn["sfx"]], ["count", "hook"])
        self.assertRegex(drawn["html"], rf'fill="{ACCENT_INK}"[^>]*style="white-space:pre">0:33.6<')
        self.assert_sound_and_seek_safe(drawn)

    def test_removals_without_pauses_draw_no_pause_legend(self):
        cue = {**RECEIPT, "removed": [{"start": 10.0, "end": 20.0, "why": "bad"}], "output": 187.4}
        drawn = probe({"cue": cue})
        self.assertNotIn("pauses", texts(drawn["html"]))
        self.assertEqual([event["at"] for event in drawn["sfx"] if event["sound"] == "tick"], [1.4])

    def test_numbers_that_do_not_add_up_and_a_late_collapse_are_refused(self):
        with self.assertRaisesRegex(AssertionError, "receipt.*add up"):
            probe({"cue": {**RECEIPT, "output": 100}})
        with self.assertRaisesRegex(AssertionError, "receipt.*collapseAt"):
            probe({"cue": {**RECEIPT, "collapseAt": 4.5}})

    def test_deterministic(self):
        self.assertEqual(probe({"cue": RECEIPT}), probe({"cue": RECEIPT}))


SHEET = [
    {"kind": "paperScene", "at": 0.2, "end": 3.0, "label": "— INPUT"},
    {"kind": "bigWord", "at": 0.5, "end": 2.8, "count": {"from": 99, "to": 100, "suffix": "%"}, "countAt": 0.5},
    {"kind": "chipRail", "at": 0.6, "end": 2.8, "y": 1200, "chips": [{"text": "Raw", "at": 0.2, "tone": "ghost"}, {"text": "Ungraded", "at": 0.2, "tone": "accent"}]},
    {"kind": "bigWord", "at": 3.2, "end": 4.8, "text": "POSSIBLE", "size": 180, "drop": True},
]


@needs_renderer(hf_installed())
class LearningBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        cls.work = scratch_work(cls.folder.name, "learn", make_edl([(0, 180)]), SHEET)
        cls.front = build(cls.work, "learn", "--events")

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    def test_builds_seek_safe_with_known_sounds(self):
        self.assertEqual(self.front.returncode, 0, self.front.stderr)
        assert_seek_safe(self, tweens((self.work / "hf" / "learn" / "index.html").read_text(encoding="utf-8")))
        events = json.loads((self.work / "edl" / "learn.sfx.json").read_text(encoding="utf-8"))["events"]
        self.assertEqual({event["kind"] for event in events}, {"paperScene", "bigWord", "chipRail"})
        self.assertFalse({event["sound"] for event in events} - KNOWN_SOUNDS)

    def test_the_house_theme_refuses_learning_kinds(self):
        result = build_any(self.work, "learn")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("theme zkidz does not draw", result.stderr)

    def test_two_builds_are_byte_identical(self):
        first = (self.work / "hf" / "learn" / "index.html").read_bytes()
        self.assertEqual(build(self.work, "learn").returncode, 0)
        self.assertEqual((self.work / "hf" / "learn" / "index.html").read_bytes(), first)



FPS = 30000 / 1001
CLIP = "media/clip-footageCard-0123456789.mp4"
VIDEO = re.compile(r"<video [^>]*>")
FULL_BLEED = {"left": 0, "top": 0, "width": 1080, "height": 1920}


def video_tags(html):
    return VIDEO.findall(html)


def attr(tag, name):
    return re.search(rf'{name}="([^"]*)"', tag).group(1)


def last_frame_local(start=1, stop=3):
    """The cue's last drawn frame, in seconds after its start (compose.js: frames from the ceiling of start)."""
    return (math.ceil(stop * FPS - 1e-6) - 1) / FPS - start


@needs_renderer(hf_installed())
class FootageCardTests(SoundsAndSeeksMixin, unittest.TestCase):
    CUE = {"kind": "footageCard", "src": CLIP, "ranges": [[30, 60, False], [100, 130, False]]}

    def test_one_muted_clip_video_timed_like_its_clip_wrapper(self):
        drawn = render(**self.CUE)
        tag, = video_tags(drawn["html"])
        self.assertIn('class="clip"', tag)
        self.assertIn(" muted", tag)
        self.assertEqual(attr(tag, "src"), CLIP)
        # The wrapper opens a quarter frame early (compose.js); the video does too, so each seek lands inside its frame.
        self.assertAlmostEqual(float(attr(tag, "data-start")), (30 - 0.25) / FPS, places=6)
        self.assertAlmostEqual(float(attr(tag, "data-duration")), 60 / FPS, places=6)
        self.assertNotIn("data-media-start", tag)
        self.assertNotIn("transform", tag)
        self.assert_sound_and_seek_safe(drawn)

    def test_a_clip_shifted_before_its_window_starts_at_zero_and_skips_into_the_media(self):
        tag, = video_tags(render(**self.CUE, start=-0.5, stop=1.5)["html"])
        self.assertEqual(float(attr(tag, "data-start")), 0)
        self.assertAlmostEqual(float(attr(tag, "data-media-start")), (0.25 + 14) / FPS, places=6)

    def test_a_centred_portrait_card_by_default_rounded_with_a_soft_shadow(self):
        html = render(**self.CUE)["html"]
        self.assertIn("left:253px;top:380px;width:574px;height:1020px", html)
        self.assertIn("border-radius:28px", html)
        self.assertIn("box-shadow:", html)
        self.assertIn("left:100px;top:300px;width:880px;height:495px;border-radius:12px", render(**self.CUE, rect=[100, 300, 880, 495], radius=12)["html"])

    def test_grow_reaches_full_bleed_on_the_last_frame_and_hands_off(self):
        drawn = render(**self.CUE, grow={"dur": 0.6})
        grow, = [spec for spec in specs(drawn, ".card") if "width" in spec["to"]]
        self.assertAlmostEqual(grow["at"], 1.4)
        self.assertAlmostEqual(grow["at"] + grow["to"]["duration"], last_frame_local(), places=6)
        self.assertEqual({key: grow["to"][key] for key in FULL_BLEED}, FULL_BLEED)
        self.assertEqual(grow["to"]["borderRadius"], "0px")
        self.assertEqual(grow["from"]["left"], 253)
        self.assertEqual(drawn["exit"], [], "the real footage takes over: nothing leaves")
        self.assertEqual(sounds(drawn), [(1.4, "swish")])
        self.assertNotIn("linear", json.dumps(drawn["motion"]))
        self.assert_sound_and_seek_safe(drawn)

    def test_grow_ending_before_the_cue_end_is_refused_by_name(self):
        with self.assertRaisesRegex(AssertionError, "footageCard.*grow"):
            render(**self.CUE, grow={"at": 1.0, "dur": 0.5})

    def test_shrink_starts_full_bleed_and_settles_on_the_card(self):
        drawn = render(**self.CUE, shrink={"at": 0.4, "dur": 0.5}, start=8, stop=10)
        self.assertIn("left:0px;top:0px;width:1080px;height:1920px;border-radius:0px", drawn["html"])
        shrink, = [spec for spec in specs(drawn, ".card") if "width" in spec["to"]]
        self.assertEqual({key: shrink["from"][key] for key in FULL_BLEED}, FULL_BLEED)
        self.assertEqual((shrink["at"], shrink["to"]["left"], shrink["to"]["width"]), (0.4, 253, 574))
        self.assertEqual(drawn["exit"], [], "the loop ending holds the card")
        self.assertEqual(sounds(drawn), [(0.4, "swish")])
        self.assert_sound_and_seek_safe(drawn)

    def test_grow_and_shrink_together_and_a_late_shrink_are_refused(self):
        with self.assertRaisesRegex(AssertionError, "grow or shrink"):
            render(**self.CUE, grow={"dur": 0.5}, shrink={"dur": 0.5})
        with self.assertRaisesRegex(AssertionError, "shrink"):
            render(**self.CUE, shrink={"at": 1.8, "dur": 0.5})

    def test_file_timecode_chips_status_and_progress_chrome(self):
        drawn = render(**self.CUE, file="VID_20261013_112759_175.MP4", timecode=True, chips=[{"text": "Raw", "tone": "ink"}, {"text": "Ungraded", "tone": "ink"}],
                       status="Camera original · no cuts", progress=True)
        words = texts(drawn["html"])
        self.assertEqual(words[0], "VID_20261013_112759_175.MP4")
        self.assertIn("RAW", words)
        self.assertIn("UNGRADED", words)
        self.assertIn("CAMERA ORIGINAL · NO CUTS", words)
        # One timecode line per drawn frame, the source frame's non-drop HH:MM:SS:FF, jumping with the cut.
        labels = [word for word in words if re.fullmatch(r"\d\d:\d\d:\d\d:\d\d", word)]
        self.assertEqual(len(labels), 60)
        self.assertEqual((labels[0], labels[29], labels[30]), ("00:00:01:00", "00:00:01:29", "00:00:03:10"))
        strip, = specs(drawn, ".tc-strip")
        head, = specs(drawn, ".head")
        for track in (strip, head):
            frames = track["to"]["keyframes"]
            self.assertEqual(len(frames), 60)
            self.assertTrue(all(frame["ease"] == "steps(1)" for frame in frames[1:]))
        # Each switch falls mid-frame, so no seek can land on its edge.
        switches = [strip["at"]]
        for frame in strip["to"]["keyframes"][1:]:
            switches.append(switches[-1] + frame["duration"])
        self.assertAlmostEqual((1 + switches[1]) * FPS % 1, 0.5, places=5)
        line = -strip["to"]["keyframes"][1]["y"]
        self.assertGreater(line, 0)
        self.assertAlmostEqual(strip["to"]["keyframes"][-1]["y"], -59 * line)
        self.assertGreater(head["to"]["keyframes"][-1]["x"], head["to"]["keyframes"][1]["x"])
        self.assertIn(f'fill="{ACCENT}"', drawn["html"])
        self.assert_sound_and_seek_safe(drawn)

    def test_a_file_name_running_into_the_timecode_is_refused_by_name(self):
        with self.assertRaisesRegex(AssertionError, "footageCard.*overrun"):
            render(**self.CUE, file="VID_20261013_112759_175_SECOND_ANGLE_FINAL.MP4", timecode=True)
        render(**self.CUE, file="VID_20261013_112759_175_SECOND_ANGLE_FINAL.MP4")

    def test_a_timecode_without_ranges_and_a_missing_src_are_refused(self):
        with self.assertRaisesRegex(AssertionError, "footageCard.*src"):
            render(kind="footageCard")
        with self.assertRaisesRegex(AssertionError, "ranges"):
            render(kind="footageCard", src=CLIP, timecode=True)
        with self.assertRaisesRegex(AssertionError, "grade"):
            render(**self.CUE, grade="graded")


@needs_renderer(hf_installed())
class GradeWipeTests(SoundsAndSeeksMixin, unittest.TestCase):
    CUE = {"kind": "gradeWipe", "src": "media/clip-gradeWipe-0123456789.mp4", "wipeAt": 0.8}

    def test_the_ungraded_clip_full_frame_with_a_muted_video(self):
        drawn = render(**self.CUE)
        tag, = video_tags(drawn["html"])
        self.assertIn('class="clip"', tag)
        self.assertIn(" muted", tag)
        self.assertIn('class="box raw" style="left:0px;top:0px;width:1080px;height:1920px', drawn["html"])
        self.assertEqual(texts(drawn["html"]), ["GRADED", "UNGRADED"])
        self.assert_sound_and_seek_safe(drawn)

    def test_the_divider_sweeps_left_to_right_clipping_the_ungraded_layer_to_its_right(self):
        drawn = render(**self.CUE)
        clip, = [spec for spec in specs(drawn, ".raw") if "clipPath" in spec["to"]]
        self.assertEqual((clip["at"], clip["from"]["clipPath"], clip["to"]["clipPath"]), (0.8, "inset(0px 0px 0px 0px)", "inset(0px 0px 0px 1080px)"))
        self.assertAlmostEqual(clip["to"]["duration"], 0.73)
        self.assertEqual(clip["to"]["ease"], "power2.inOut")
        for target in (".divider", ".riders"):
            sweep, = [spec for spec in specs(drawn, target) if "x" in spec["to"]]
            self.assertEqual((sweep["at"], sweep["from"]["x"], sweep["to"]["x"], sweep["to"]["ease"]), (0.8, 0, 1080, "power2.inOut"))
            self.assertAlmostEqual(sweep["to"]["duration"], 0.73)
        self.assertIn(f'fill="{ACCENT}"', drawn["html"])
        self.assertIn(f'fill="{INK}"', drawn["html"])
        self.assertEqual(sounds(drawn), [(0.8, "swish")])

    def test_graded_rides_left_of_the_divider_and_ungraded_right(self):
        html = render(**self.CUE)["html"]
        xs = [float(x) for x in re.findall(r'<rect class="chip-plate" x="([-\d.]+)"', html)]
        self.assertLess(xs[0], 0)
        self.assertGreater(xs[1], 0)

    def test_a_wipe_too_late_for_its_sweep_and_a_graded_wipe_are_refused_by_name(self):
        with self.assertRaisesRegex(AssertionError, "gradeWipe.*wipeAt"):
            render(**{**self.CUE, "wipeAt": 1.5})
        with self.assertRaisesRegex(AssertionError, "gradeWipe.*raw"):
            render(**self.CUE, grade="edit")


FOOTAGE_SHEET = [
    {"kind": "footageCard", "at": 0.5, "end": 2.5, "grow": {"dur": 0.5}, "file": "VID_1.MP4", "timecode": True},
    {"kind": "gradeWipe", "at": 3.0, "end": 5.0, "wipeAt": 0.6},
]


@needs_renderer(hf_installed())
class FootageBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        cls.work = scratch_work(cls.folder.name, "foot", make_edl([(0, 60), (100, 200)]), FOOTAGE_SHEET)
        cls.result = build(cls.work, "foot", "--events")
        cls.html = (cls.work / "hf" / "foot" / "index.html").read_text(encoding="utf-8")

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    def test_each_footage_cue_gets_its_page_relative_clip_without_the_clips_yet(self):
        self.assertEqual(self.result.returncode, 0, self.result.stderr)
        srcs = [attr(tag, "src") for tag in video_tags(self.html)]
        self.assertEqual(len(srcs), 2)
        self.assertRegex(srcs[0], r"^media/clip-footageCard-[0-9a-f]{10}\.mp4$")
        self.assertRegex(srcs[1], r"^media/clip-gradeWipe-[0-9a-f]{10}\.mp4$")
        assert_seek_safe(self, tweens(self.html))

    def test_the_clip_manifest_names_each_cue_s_source_runs_and_grade(self):
        result = build(self.work, "foot", "--clips")
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads((self.work / "edl" / "foot.clips.json").read_text(encoding="utf-8"))
        self.assertEqual((manifest["video"], manifest["base"], manifest["fps_num"], manifest["fps_den"]), ("foot", "foot", 30000, 1001))
        card, wipe = manifest["clips"]
        self.assertEqual((card["kind"], card["grade"], wipe["kind"], wipe["grade"]), ("footageCard", "edit", "gradeWipe", "raw"))
        self.assertEqual(card["file"], f"cardclips/foot-{card['id']}.mp4")
        self.assertEqual(sum(to - start for start, to, _ in card["ranges"]), card["frames"])
        self.assertEqual(set(card), {"id", "kind", "at", "start", "stop", "firstFrame", "frames", "grade", "ranges", "file"})

    def test_footage_sounds_are_known(self):
        events = json.loads((self.work / "edl" / "foot.sfx.json").read_text(encoding="utf-8"))["events"]
        self.assertTrue(events)
        self.assertFalse({event["sound"] for event in events} - KNOWN_SOUNDS)


# The edit drops source 1.5–2.5 s (frames 45–75), so the shrink pinned at source 2.8 s plays at edited frame 53.9.
CUT_SHEET = [{"kind": "footageCard", "at": 1.0, "end": 4.0, "shrink": {"at": 1.8, "dur": 0.5}}]


@needs_renderer(hf_installed())
class FootageAcrossACutTests(unittest.TestCase):
    def test_sounds_use_the_movement_pins_mapped_onto_the_edit(self):
        with tempfile.TemporaryDirectory() as folder:
            work = scratch_work(folder, "cut", make_edl([(0, 45), (75, 200)]), CUT_SHEET)
            result = build(work, "cut", "--events")
            self.assertEqual(result.returncode, 0, result.stderr)
            events = json.loads((work / "edl" / "cut.sfx.json").read_text(encoding="utf-8"))["events"]
            card = tweens((work / "hf" / "cut" / "index.html").read_text(encoding="utf-8"))
        swish, = events  # the kind's swish, as the sound design names it
        self.assertAlmostEqual(swish["time"], (45 + 2.8 * FPS - 75) / FPS, places=6)
        shrink, = [spec for spec in card if spec["target"].endswith(".card") and "width" in spec["to"]]
        # Tweens snap to the frame grid (compose.js); the sound lands in the frame the card moves on.
        self.assertAlmostEqual(shrink["at"], swish["time"], delta=0.5 / FPS)


ZOOMED_SHEET = [{"kind": "footageCard", "at": 1.0, "end": 2.0}]


@needs_renderer(hf_installed())
class FootageOverAZoomTests(unittest.TestCase):
    def built(self, zooms, *args):
        with tempfile.TemporaryDirectory() as folder:
            work = scratch_work(folder, "zm", {**make_edl([(0, 200)]), "zooms": zooms}, ZOOMED_SHEET)
            return build(work, "zm", *args)

    def test_a_card_overlapping_an_animated_zoom_or_portal_is_refused_by_name(self):
        for preset in ("snap", "portal"):
            zoom = {"start": 50, "end": 70, "preset": preset, "cx": 0.5, "cy": 0.5, **({"to": 2.0} if preset == "portal" else {})}
            for args in ((), ("--clips",)):
                result = self.built([zoom], *args)
                self.assertNotEqual(result.returncode, 0, (preset, args))
                self.assertIn("footageCard at 1s overlaps an animated zoom", result.stderr)

    def test_a_zoom_outside_the_card_is_fine(self):
        # The card draws frames 30–59; a zoom from its end frame on never meets it.
        result = self.built([{"start": 60, "end": 80, "preset": "snap", "cx": 0.5, "cy": 0.5}], "--clips")
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
