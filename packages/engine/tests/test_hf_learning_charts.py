# Created by The Angelo Umali.
# The learning-vlog explainer graphics for paper scenes: stepBars (a relative rise, no numbers), listRows (rows with a check),
# and bigWord's strike. Needs node; kind probes as in test_hf_learning.py.
import re
import unittest

from support import hf_installed, needs_renderer  # first: it sets a scratch ZKS_HOME
from test_hf_learning import ACCENT, ACCENT_INK, INK, RULE, WHITE, SoundsAndSeeksMixin, fills_of_texts, probe, render, specs, texts  # first: it puts the engine on sys.path

BAR = re.compile(r'<rect class="bar" x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"[^>]*fill="([^"]+)"')


@needs_renderer(hf_installed())
class StepBarsTests(SoundsAndSeeksMixin, unittest.TestCase):
    BARS = [{"label": "mine", "height": 0.45, "at": 0.2}, {"label": "theirs", "height": 1, "at": 0.9}]

    def test_bars_rise_from_one_baseline_on_their_pins(self):
        drawn = render(kind="stepBars", bars=self.BARS, y=1200, maxHeight=500)
        bars = BAR.findall(drawn["html"])
        self.assertEqual({round(float(y) + float(h), 3) for _, y, _, h, _ in bars}, {1200.0})
        self.assertAlmostEqual(float(bars[1][3]) / float(bars[0][3]), 1 / 0.45, places=3)
        grows = [spec for spec in drawn["motion"] if re.fullmatch(r"\.bar\d", spec["target"])]
        self.assertEqual([spec["at"] for spec in grows], [0.2, 0.9])
        self.assertTrue(all(spec["from"]["scaleY"] == 0 and spec["to"]["scaleY"] == 1 for spec in grows))
        self.assertEqual(texts(drawn["html"]), ["MINE", "THEIRS"])
        self.assertEqual([event["at"] for event in drawn["sfx"]][:2], [0.2, 0.9])
        self.assert_sound_and_seek_safe(drawn)

    def test_the_last_bar_is_the_accent_and_the_others_ink(self):
        self.assertEqual([fill for *_, fill in BAR.findall(render(kind="stepBars", bars=self.BARS)["html"])], [INK, ACCENT])

    def test_labels_are_white_over_footage_and_ink_on_paper(self):
        # Navy labels over footage vanished on a dark monitor (Claude's edit, "FASTER" at 1:16).
        self.assertEqual(set(fills_of_texts(render(kind="stepBars", bars=self.BARS)["html"])), {WHITE})
        paper = {"kind": "paperScene", "start": 0.5, "stop": 4}
        self.assertEqual(set(fills_of_texts(probe({"cue": {"kind": "stepBars", "bars": self.BARS}, "cues": [paper]})["html"])), {INK})

    def test_the_arrow_draws_on_after_the_last_bar_lands(self):
        drawn = render(kind="stepBars", bars=self.BARS, arrow=True)
        arrow = specs(drawn, ".arrow")
        self.assertTrue(arrow)
        self.assertGreater(arrow[0]["at"], 0.9)
        self.assertIn(f'stroke="{RULE}"', drawn["html"].split('class="u arrow')[1])
        self.assertNotIn(".arrow", [spec["target"] for spec in render(kind="stepBars", bars=self.BARS)["motion"]])

    def test_a_height_outside_a_share_is_refused_by_name(self):
        with self.assertRaisesRegex(AssertionError, "theirs"):
            render(kind="stepBars", bars=[{"label": "theirs", "height": 1.4, "at": 0}])


@needs_renderer(hf_installed())
class ListRowsTests(SoundsAndSeeksMixin, unittest.TestCase):
    ROWS = [{"text": "Finance", "at": 0.2, "mark": "check"}, {"text": "Business", "at": 0.6, "mark": "check"}, {"text": "Trading", "at": 1.4, "mark": "check", "tone": "accent"}]

    def test_rows_slide_in_on_their_pins_and_their_checks_draw_after(self):
        drawn = render(kind="listRows", rows=self.ROWS, y=700)
        self.assertEqual(texts(drawn["html"]), ["Finance", "Business", "Trading"])
        slides = [spec for spec in drawn["motion"] if re.fullmatch(r"\.row\d", spec["target"])]
        self.assertEqual([spec["at"] for spec in slides], [0.2, 0.6, 1.4])
        marks = [spec for spec in drawn["motion"] if re.fullmatch(r"\.mark\d", spec["target"])]
        self.assertEqual(len(marks), 3)
        self.assertTrue(all(mark["at"] > slide["at"] for mark, slide in zip(marks, slides)))
        self.assertEqual([event["sound"] for event in drawn["sfx"]], ["check"] * 3)
        self.assert_sound_and_seek_safe(drawn)

    def test_rows_step_down_by_their_gap_and_take_their_tone(self):
        html = render(kind="listRows", rows=self.ROWS, y=700, gap=150)["html"]
        baselines = [float(y) for y in re.findall(r'<text x="[\d.]+" y="([\d.]+)"', html)]
        self.assertEqual(baselines, [700, 850, 1000])
        self.assertEqual(re.findall(r'<text [^>]*fill="([^"]+)"', html), [INK, INK, ACCENT_INK], "accent text is dark gold")

    def test_the_mark_scales_with_the_row_text(self):
        def mark_span(size):
            path = re.search(r'class="u mark mark0"[^>]*>.*?<path d="M([\d.]+) [\d.]+ L[\d.]+ [\d.]+ L([\d.]+)', render(kind="listRows", rows=self.ROWS[:1], size=size)["html"])
            return float(path.group(2)) - float(path.group(1))
        self.assertAlmostEqual(mark_span(152) / mark_span(76), 2, places=2)

    def test_a_row_without_a_mark_ticks_and_draws_no_mark(self):
        drawn = render(kind="listRows", rows=[{"text": "Finance", "at": 0.2}])
        self.assertNotIn("mark", drawn["html"])
        self.assertEqual([event["sound"] for event in drawn["sfx"]], ["tick"])

    def test_a_row_wider_than_the_frame_is_refused_by_name(self):
        with self.assertRaisesRegex(AssertionError, "careers that AI will never"):
            render(kind="listRows", rows=[{"text": "careers that AI will never touch at all", "at": 0}], size=90)


@needs_renderer(hf_installed())
class BigWordStrikeTests(SoundsAndSeeksMixin, unittest.TestCase):
    def test_a_strike_draws_through_the_word_on_its_pin(self):
        drawn = render(kind="bigWord", text="TOYS", size=200, strikeAt=0.8)
        self.assertEqual([spec["at"] for spec in specs(drawn, ".strike")], [0.8])
        self.assertIn(f'fill="{ACCENT}"', drawn["html"].split('class="u strike')[1][:400])
        self.assertIn((0.8, "rule"), [(event["at"], event["sound"]) for event in drawn["sfx"]])
        self.assert_sound_and_seek_safe(drawn)

    def test_no_strike_without_its_pin(self):
        self.assertNotIn("strike", render(kind="bigWord", text="TOYS", size=200)["html"])


if __name__ == "__main__":
    unittest.main()
