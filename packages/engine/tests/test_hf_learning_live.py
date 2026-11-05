# Created by The Angelo Umali.
# The live learning kinds (#20): real UI rebuilt and animated, never pictograms or invented data. meterGauge, receiptPrint,
# phoneScreen, chatThread, tradeScreen, flowSteps, bigWord's slot and scribble, and stepBars' dimensional levels. Needs node.
import json
import re
import unittest
from html import unescape

from support import hf_installed, needs_renderer  # first: it sets a scratch ZKS_HOME
from test_hf_learning import ACCENT, ACCENT_INK, GOLD_TOP, SAND, SoundsAndSeeksMixin, render, specs, texts  # first: the engine path
from test_hf_bridge import FULL, PAUSE, map_cues

FONT_SIZE = re.compile(r'font-size="([\d.]+)"')


def ends_at(spec):
    """When a keyframes track ends, in seconds after the cue start."""
    return spec["at"] + sum(frame.get("duration", 0) for frame in spec["to"]["keyframes"])


def keyframes(drawn, target):
    [track] = [spec for spec in drawn["motion"] if spec["target"] == target and "keyframes" in spec.get("to", {})]
    return track


def matching(drawn, pattern):
    """The motion specs whose target matches `pattern` (a regex) whole."""
    return [spec for spec in drawn["motion"] if re.fullmatch(pattern, spec["target"])]


class SeededMixin:
    def assert_seeded(self, cue, other_seed):
        self.assertEqual(render(**cue)["html"], render(**cue)["html"])
        self.assertNotEqual(render(**cue)["html"], render(**{**cue, "seed": other_seed})["html"])


def visible_text(html):
    """Every text node the page would show: SVG text and any HTML text between tags."""
    return [unescape(text).strip() for text in re.findall(r">([^<]+)<", html) if unescape(text).strip()]


@needs_renderer(hf_installed())
class MeterGaugeTests(SoundsAndSeeksMixin, unittest.TestCase):
    CUE = {"kind": "meterGauge", "label": "Burnout meter", "tag": "Burnout · rarely", "level": 0.15, "settleAt": 1.2}

    def test_draws_its_label_tag_and_ends_only(self):
        self.assertEqual(texts(render(**self.CUE)["html"]), ["BURNOUT METER", "BURNOUT · RARELY", "LOW", "HIGH"])

    def test_three_zones_draw_on_gold_sand_orange(self):
        drawn = render(**self.CUE)
        arcs = re.findall(r'<path d="[^"]+" pathLength="1"[^>]*stroke="([^"]+)"', drawn["html"])
        self.assertEqual(arcs[:3], [ACCENT, SAND, ACCENT_INK])
        self.assertTrue(specs(drawn, ".mg-arc path"))

    def test_the_needle_kicks_up_overshoots_and_settles_on_its_level_at_its_pin(self):
        drawn = render(**self.CUE, stop=4)
        needle = keyframes(drawn, ".mg-needle")
        rotations = [frame["rotation"] for frame in needle["to"]["keyframes"]]
        self.assertGreater(max(rotations), 0.15 * 180 + 30, "kicks up past its level")
        self.assertAlmostEqual(rotations[-1], 0.15 * 180)
        self.assertAlmostEqual(ends_at(needle), 1.2, places=6)
        self.assertIn("back.out", needle["to"]["keyframes"][-1]["ease"], "settles with a soft overshoot")
        self.assertIn((1.2, "tick"), [(event["at"], event["sound"]) for event in drawn["sfx"]])
        self.assert_sound_and_seek_safe(drawn)

    def test_a_level_off_the_dial_is_refused_by_label(self):
        with self.assertRaisesRegex(AssertionError, "Burnout meter"):
            render(**{**self.CUE, "level": 1.4})


@needs_renderer(hf_installed())
class ReceiptPrintTests(SoundsAndSeeksMixin, unittest.TestCase):
    CUE = {"kind": "receiptPrint", "title": "Toys bought", "lines": [{"text": "Since age", "value": "6", "at": 0.4}], "total": 0,
           "totalAt": 1.0, "stop": 4}

    def test_draws_its_title_lines_and_total(self):
        words = texts(render(**self.CUE)["html"])
        for word in ("TOYS BOUGHT", "SINCE AGE", "6", "TOTAL", "0"):
            self.assertIn(word, words)

    def test_the_paper_unrolls_title_first_on_each_line_pin_then_the_total(self):
        # It fed out bottom first, so the TOTAL row showed before the lines; it now unrolls from the slot down.
        drawn = render(**self.CUE)
        reveal = keyframes(drawn, ".rp-reveal")
        hidden = lambda frame: float(re.fullmatch(r"inset\(0px 0px ([\d.]+)px 0px\)", frame["clipPath"]).group(1))  # noqa: E731
        frames, clock, moves = reveal["to"]["keyframes"], reveal["at"], []
        for before, frame in zip(frames, frames[1:]):
            if hidden(frame) != hidden(before):
                moves.append(round(clock, 6))
            clock += frame["duration"]
        self.assertEqual(moves[:2], [0.4, 1.0])
        length = float(re.search(r'class="u rp-paper" style="width:[\d.]+px;height:([\d.]+)px', drawn["html"]).group(1))
        self.assertEqual(hidden(frames[0]), length, "nothing shows before the first line")
        self.assertEqual(hidden(frames[-1]), 0, "fully unrolled")
        self.assertNotIn("height", json.dumps(reveal), "a clip, not a layout-changing height")
        self.assertFalse(specs(drawn, ".rp-paper"), "the paper itself holds still")

    def test_the_total_rolls_and_lands_orange_on_its_pin(self):
        drawn = render(**self.CUE)
        rolls = matching(drawn, r"\.rp-roll\d+")
        self.assertTrue(rolls)
        self.assertEqual({spec["at"] for spec in rolls}, {1.0})
        self.assertIn(f'fill="{ACCENT_INK}"', drawn["html"].split('class="u rp-total')[1])
        self.assertIn("clip-path:polygon", drawn["html"], "a torn edge")
        self.assert_sound_and_seek_safe(drawn)

    def test_a_line_after_the_total_and_a_line_too_wide_are_refused_by_text(self):
        with self.assertRaisesRegex(AssertionError, "Since age"):
            render(**{**self.CUE, "lines": [{"text": "Since age", "value": "6", "at": 1.4}]})
        with self.assertRaisesRegex(AssertionError, "everything he ever wanted"):
            render(**{**self.CUE, "lines": [{"text": "everything he ever wanted", "value": "6", "at": 0.2}]})


@needs_renderer(hf_installed())
class PhoneScreenTests(SoundsAndSeeksMixin, unittest.TestCase):
    SAVINGS = {"kind": "phoneScreen", "screen": "savings", "beats": [{"at": 0.4, "fill": 0.62}, {"at": 1.6, "pay": True}], "stop": 5}
    ALLOWANCE = {"kind": "phoneScreen", "screen": "allowance", "beats": [{"at": 0.5, "jar": "save"}, {"at": 1.1, "jar": "spend"}], "stop": 5}
    CART = {"kind": "phoneScreen", "screen": "cart", "beats": [{"at": 0.8, "remove": True}], "stop": 5}

    def min_text_px(self, cue):
        html = render(**cue)["html"]
        scale = float(re.search(r'data-scale="([\d.]+)"', html).group(1))
        screen = html.split('class="ps-screen"')[1]
        return min(float(size) for size in FONT_SIZE.findall(screen)) * scale

    def test_ui_text_is_at_least_30_px_on_every_screen(self):
        for cue in (self.SAVINGS, self.ALLOWANCE, self.CART):
            self.assertGreaterEqual(self.min_text_px(cue), 30, cue["screen"])

    def test_a_phone_too_small_for_30_px_text_is_refused_by_name(self):
        with self.assertRaisesRegex(AssertionError, "phoneScreen savings"):
            render(**{**self.SAVINGS, "w": 300})

    def test_a_tilted_3d_phone_with_a_soft_shadow_settles_on_its_tilt(self):
        drawn = render(**{**self.SAVINGS, "tilt": 12})
        self.assertIn("perspective", drawn["html"])
        self.assertIn("box-shadow", drawn["html"])
        [turn] = [spec for spec in specs(drawn, ".ps-tilt") if "rotationY" in spec["to"]]
        self.assertEqual(turn["to"]["rotationY"], 12)

    def test_savings_ring_fills_on_its_beat_and_the_pay_button_pulses_on_its_own(self):
        drawn = render(**self.SAVINGS)
        ring = keyframes(drawn, ".ps-ring")
        length = float(re.search(r'class="ps-ring"[^>]*stroke-dasharray="([\d.]+) ', drawn["html"]).group(1))
        self.assertAlmostEqual(ring["to"]["keyframes"][-1]["strokeDashoffset"] / length, 1 - 0.62, places=3)
        self.assertGreaterEqual(ring["at"] + ring["to"]["keyframes"][0]["duration"] + ring["to"]["keyframes"][1]["duration"], 0.4)
        pulse = specs(drawn, ".ps-pulse")
        self.assertEqual([spec["at"] for spec in pulse][:1], [1.6])
        self.assertEqual(texts(drawn["html"])[:2], ["Savings", "ON TRACK"])
        self.assert_sound_and_seek_safe(drawn)

    def test_allowance_drops_a_coin_into_each_named_jar_on_its_beat(self):
        drawn = render(**self.ALLOWANCE)
        drops = [spec for spec in matching(drawn, r"\.ps-coin\d") if "y" in spec["to"]]
        self.assertEqual([spec["at"] for spec in drops], [0.5, 1.1])
        self.assertIn("SAVE", texts(drawn["html"]))
        self.assertIn("SPEND", texts(drawn["html"]))
        self.assert_sound_and_seek_safe(drawn)

    def test_cart_swipes_the_toy_out_and_lands_the_count_on_zero(self):
        drawn = render(**self.CART)
        swipe = [spec for spec in specs(drawn, ".ps-item") if "x" in spec["to"]]
        self.assertEqual([spec["at"] for spec in swipe], [0.8])
        self.assertLess(swipe[0]["to"]["x"], -200)
        words = texts(drawn["html"])
        for word in ("Cart", "1", "0", "REMOVE", "Cart is empty"):
            self.assertIn(word, words)
        self.assertTrue(any(spec["at"] > 0.8 for spec in specs(drawn, ".ps-empty")))
        self.assert_sound_and_seek_safe(drawn)

    def test_the_screen_clips_its_contents_to_its_rounded_glass(self):
        # A mid-swipe card ran past the bezel: overflow alone does not clip inside a 3D-transformed phone.
        html = render(**self.CART)["html"]
        screen = re.search(r'<div class="ps-glass" style="([^"]+)"', html).group(1)
        self.assertRegex(screen, r"clip-path:inset\(0(px)? round [\d.]+px\)")
        self.assertNotIn("preserve-3d", html)

    def test_the_phone_shakes_as_the_count_lands_with_motion_ticks(self):
        drawn = render(**self.CART)
        shake = keyframes(drawn, ".ps-shake")
        rotations = [frame["rotation"] for frame in shake["to"]["keyframes"]]
        self.assertAlmostEqual(shake["at"], 0.8 + 0.3)
        self.assertEqual(max(abs(r) for r in rotations), 4)
        self.assertEqual((rotations[0], rotations[-1]), (0, 0))
        self.assertAlmostEqual(ends_at(shake) - shake["at"], 0.3, places=6)
        ticks = keyframes(drawn, ".ps-ticks")
        self.assertAlmostEqual(ticks["at"], shake["at"])
        self.assertEqual(drawn["html"].count('class="ps-tick"'), 6, "three ( on the left, three ) on the right")
        self.assert_sound_and_seek_safe(drawn)

    def test_an_unknown_screen_and_a_beat_the_screen_cannot_play_are_refused_by_name(self):
        with self.assertRaisesRegex(AssertionError, "wallet"):
            render(kind="phoneScreen", screen="wallet", beats=[])
        with self.assertRaisesRegex(AssertionError, "phoneScreen allowance beat at 0.5"):
            render(kind="phoneScreen", screen="allowance", beats=[{"at": 0.5, "jar": "piggy"}])


@needs_renderer(hf_installed())
class ChatThreadTests(SoundsAndSeeksMixin, unittest.TestCase):
    CUE = {"kind": "chatThread", "stop": 6, "messages": [
        {"from": "me", "text": "Can AI replace these careers?", "at": 0.3},
        {"from": "assistant", "text": "Less likely. They run on people", "at": 2.2},
    ]}

    def test_the_question_types_in_the_field_then_flies_up_as_a_bubble(self):
        drawn = render(**self.CUE)
        typing = keyframes(drawn, ".ct-field")
        self.assertEqual(typing["at"], 0.3)
        bubble = [spec for spec in specs(drawn, ".ct-msg0") if "y" in spec["to"]]
        self.assertEqual(len(bubble), 1)
        self.assertGreater(bubble[0]["at"], ends_at(typing) - 1e-6)
        self.assertGreater(bubble[0]["from"]["y"], 0, "rises from the field")

    def test_the_reply_streams_word_by_word_with_a_caret(self):
        # One text per line, its clip opening to each word's end on that word's beat (no unit per word).
        drawn = render(**self.CUE)
        lines = sorted(matching(drawn, r"\.ct-line1-\d+"), key=lambda spec: spec["at"])
        beats = []
        for line in lines:
            clock = line["at"]
            for frame in line["to"]["keyframes"][1:]:
                clock += frame["duration"]
                beats.append(round(clock, 6))
        self.assertEqual(beats, [round(2.2 + index * 0.09, 6) for index in range(6)], "six words, 0.09 s apart from the reply's pin")
        self.assertNotIn("ct-w1-", drawn["html"])
        self.assertTrue(specs(drawn, ".ct-caret1"))
        self.assert_sound_and_seek_safe(drawn)

    def test_draws_only_its_own_words_and_the_assistant_name(self):
        words = " ".join(texts(render(**self.CUE)["html"]))
        for word in ("Assistant", "Can AI replace these careers?", "Less", "people"):
            self.assertIn(word, words)

    def test_a_wrapped_question_bubble_keeps_its_line_spacing(self):
        # The typing cadence must not overwrite the bubble's line step (32 px x 1.3).
        question = "Can AI replace these careers for my kids?"
        html = render(kind="chatThread", stop=6, w=820, messages=[{"from": "me", "text": question, "at": 0.3}])["html"]
        rows = [float(y) for y in re.findall(r'<text x="[\d.]+" y="([\d.]+)"[^>]*font-size="32"[^>]*>[^<]+</text>', html)]
        self.assertEqual(len(rows), 2, "the bubble wraps to two lines")
        self.assertAlmostEqual(rows[1] - rows[0], 32 * 1.3, places=1)

    def test_an_unknown_sender_is_refused_by_name(self):
        with self.assertRaisesRegex(AssertionError, "robot"):
            render(kind="chatThread", messages=[{"from": "robot", "text": "Hi", "at": 0}])


@needs_renderer(hf_installed())
class TradeScreenTests(SeededMixin, SoundsAndSeeksMixin, unittest.TestCase):
    CUE = {"kind": "tradeScreen", "seed": 11, "stop": 5.5}

    def test_no_numbers_or_ticker_anywhere(self):
        html = render(**self.CUE)["html"]
        self.assertFalse([text for text in visible_text(html) if re.search(r"\d", text)])
        self.assertIn("LIVE", visible_text(html))

    def test_candles_stream_left_for_the_whole_cue(self):
        drawn = render(**self.CUE)
        [strip] = specs(drawn, ".ts-strip")
        self.assertEqual(strip["at"], 0)
        self.assertAlmostEqual(strip["to"]["duration"], 4.5)
        self.assertLess(strip["to"]["x"], -100)
        pops = matching(drawn, r"\.ts-c\d+")
        self.assertGreater(len(pops), 5, "new candles land while it streams")
        self.assertTrue(specs(drawn, ".ts-tag"))
        self.assert_sound_and_seek_safe(drawn)

    def chart(self):
        drawn = render(**self.CUE)
        wicks = {int(index): (float(top), float(bottom)) for index, top, bottom in
                 re.findall(r'<g class="ts-c(\d+)"><line [^>]*y1="([\d.-]+)" y2="([\d.-]+)"', drawn["html"])}
        return drawn, wicks

    def test_the_price_scale_fits_the_visible_window(self):
        drawn, wicks = self.chart()
        fit = keyframes(drawn, ".ts-fit")["to"]["keyframes"][-1]
        last = max(int(spec["target"][5:]) for spec in matching(drawn, r"\.ts-c\d+"))
        window = [wicks[index] for index in range(last - 33, last + 1)]
        mapped = [fit["scaleY"] * value + fit["y"] for pair in window for value in pair]
        self.assertGreaterEqual(min(mapped), 15)
        self.assertLessEqual(max(mapped), 300 - 15)
        self.assertGreater(max(mapped) - min(mapped), 0.8 * (300 - 40), "the window fills the card")

    def test_the_trend_rises_with_a_dip_and_a_recovery(self):
        _, wicks = self.chart()
        price = [-(top + bottom) / 2 for _, (top, bottom) in sorted(wicks.items())]
        n, span = len(price), max(price) - min(price)
        peak, dip = max(price[int(0.3 * n):int(0.55 * n)]), min(price[int(0.5 * n):int(0.8 * n)])
        self.assertGreater(peak - dip, 0.15 * span, "a visible dip")
        self.assertGreater(price[-1], peak, "and a recovery to a new high")
        self.assertGreater(price[-1], price[0])

    def test_the_market_is_seeded(self):
        self.assert_seeded(self.CUE, 12)


@needs_renderer(hf_installed())
class FlowStepsTests(SoundsAndSeeksMixin, unittest.TestCase):
    CUE = {"kind": "flowSteps", "stop": 5, "steps": [
        {"label": "Chores", "kind": "check", "at": 0.2},
        {"label": "Earn", "kind": "coins", "at": 0.9},
        {"label": "Unlock", "kind": "unlock", "at": 1.6},
    ]}

    def test_each_card_lands_on_its_pin_with_its_label(self):
        drawn = render(**self.CUE)
        self.assertEqual(texts(drawn["html"]), ["CHORES", "EARN", "UNLOCK"])
        landed = [min(spec["at"] for spec in specs(drawn, f".fs-card{index}")) for index in range(3)]
        self.assertEqual(landed, [0.2, 0.9, 1.6])

    def test_chores_tick_coins_rise_and_the_lock_pops_with_a_gold_glow(self):
        drawn = render(**self.CUE)
        checks = matching(drawn, r"\.fs-check0.*")
        self.assertEqual(len(checks), 3)
        coins = matching(drawn, r"\.fs-coin1.*")
        self.assertGreaterEqual(len(coins), 4)
        self.assertTrue(specs(drawn, ".fs-shackle2") and specs(drawn, ".fs-glow2"))
        self.assertIn("nodeGold", [event["sound"] for event in drawn["sfx"]])
        self.assert_sound_and_seek_safe(drawn)

    def test_an_unknown_step_kind_is_refused_by_label(self):
        with self.assertRaisesRegex(AssertionError, "Chores"):
            render(kind="flowSteps", steps=[{"label": "Chores", "kind": "stars", "at": 0}])


@needs_renderer(hf_installed())
class CardRowsTests(SoundsAndSeeksMixin, unittest.TestCase):
    ROWS = [{"text": "FINANCE", "at": 0.2, "mark": "check", "note": "Safe"}, {"text": "TRADING", "at": 0.8, "mark": "check", "note": "Safe"}]

    def test_card_rows_are_white_cards_with_gold_check_discs_and_a_mono_note(self):
        drawn = render(kind="listRows", rows=self.ROWS, card=True, x=64, y=1010, size=60, gap=138)
        html = drawn["html"]
        self.assertEqual(len(re.findall(r'<rect class="row-card"[^>]*fill="#FFFFFF"', html)), 2)
        self.assertEqual(len(re.findall(rf'<circle class="row-disc"[^>]*fill="{ACCENT}"', html)), 2)
        notes = re.findall(r'<text [^>]*font-family="JetBrains Mono"[^>]*text-anchor="end"[^>]*>SAFE</text>', html)
        self.assertEqual(len(notes), 2)
        self.assertEqual([word for word in texts(html) if word != "SAFE"], ["FINANCE", "TRADING"])
        self.assertEqual([event["sound"] for event in drawn["sfx"]], ["check", "check"])
        self.assert_sound_and_seek_safe(drawn)

    def test_plain_rows_stay_bare(self):
        self.assertNotIn("row-card", render(kind="listRows", rows=self.ROWS)["html"])


@needs_renderer(hf_installed())
class BigWordSlotTests(SoundsAndSeeksMixin, unittest.TestCase):
    SLOT = {"fixed": "I have", "words": [{"text": "Motivation", "at": 0.2}, {"text": "Dedication", "at": 1.0, "color": ACCENT_INK}]}

    def test_the_fixed_line_holds_and_one_masked_slot_rolls_between_words(self):
        drawn = render(kind="bigWord", size=138, y=440, slot=self.SLOT, stop=4)
        self.assertEqual(texts(drawn["html"]), ["I HAVE", "MOTIVATION", "DEDICATION"])
        enters = [(spec["target"], spec["at"]) for spec in drawn["motion"] if spec["target"].startswith(".sw") and spec["from"].get("y", 0) > 0]
        self.assertEqual(enters, [(".sw0", 0.2), (".sw1", 1.0)])
        [leave] = [spec for spec in specs(drawn, ".sw0") if spec["to"].get("y", 0) < 0]
        self.assertEqual(leave["at"], 1.0)
        self.assertIn("clip-path", drawn["html"])
        self.assertIn(f'fill="{ACCENT_INK}"', drawn["html"].split("DEDICATION")[0].rsplit("<text", 1)[1])
        self.assertEqual([event["sound"] for event in drawn["sfx"]], ["tick", "tick"])
        self.assert_sound_and_seek_safe(drawn)

    def test_slot_pins_stay_on_their_words_across_a_trimmed_pause(self):
        sheet = [{"kind": "bigWord", "at": 8, "end": 14, "slot": {"fixed": "I", "words": [{"text": "A", "at": 0}, {"text": "B", "at": 4}]}}]
        [word] = map_cues(FULL, sheet)["cues"]
        self.assertAlmostEqual(word["slot"]["words"][1]["at"], 4 - PAUSE, places=6)

    def test_a_slot_word_wider_than_the_frame_is_refused_by_name(self):
        with self.assertRaisesRegex(AssertionError, "DEDICATIONAL"):
            render(kind="bigWord", size=200, slot={"fixed": "I", "words": [{"text": "DEDICATIONAL", "at": 0}]})


@needs_renderer(hf_installed())
class BigWordScribbleTests(SeededMixin, SoundsAndSeeksMixin, unittest.TestCase):
    def test_fast_orange_pen_strokes_scribble_the_word_out_on_its_pin(self):
        drawn = render(kind="bigWord", text="STRUGGLE", size=188, y=712, scribbleAt=0.9, stop=4)
        strokes = [spec for spec in matching(drawn, r"\.scrib.*") if spec["from"].get("strokeDashoffset") == 1.1]
        self.assertGreaterEqual(len(strokes), 2)
        self.assertEqual(strokes[0]["at"], 0.9)
        self.assertTrue(all(spec["to"]["duration"] <= 0.45 for spec in strokes), "fast")
        self.assertIn(f'stroke="{ACCENT_INK}"', drawn["html"].split('class="u scrib')[1])
        self.assertIn((0.9, "scratch"), [(event["at"], event["sound"]) for event in drawn["sfx"]])
        self.assert_sound_and_seek_safe(drawn)

    def test_the_strokes_are_seeded(self):
        self.assert_seeded({"kind": "bigWord", "text": "STRUGGLE", "size": 188, "scribbleAt": 0.9}, 4)


@needs_renderer(hf_installed())
class DimensionalBarsTests(unittest.TestCase):
    def test_each_bar_is_a_3d_level_with_a_lit_top_and_a_shaded_side(self):
        html = render(kind="stepBars", bars=[{"label": "Mine", "height": 0.45, "at": 0.2}, {"label": "Theirs", "height": 1, "at": 0.9}])["html"]
        self.assertEqual(len(re.findall(r'<polygon class="bar-top"', html)), 2)
        self.assertEqual(len(re.findall(r'<polygon class="bar-side"', html)), 2)
        self.assertIn(f'fill="{GOLD_TOP}"', html, "the gold level's lit top")


if __name__ == "__main__":
    unittest.main()
