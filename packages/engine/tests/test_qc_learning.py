# Created by The Angelo Umali.
# The learning theme's cue-sheet gates: visual density (hook and body) and technique variety, and when they run at all.
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from support import make_edl, write_sheet  # first: it sets a scratch ZKS_HOME

from zks_engine.qc import learning
from zks_engine.specs.gates import GateFailed

EDL = {**make_edl([(0, 300), (450, 1800)]), "zooms": []}  # a 10 s hook (frames 0-300), then 45 s of body


def bigword(at, **motion):
    return {"kind": "bigWord", "at": at, "end": at + 1, "text": "x", **motion}


def event(time):
    return {"time": time, "cueStart": time, "sound": "tick", "kind": "bigWord"}


class VarietyTests(unittest.TestCase):
    def test_a_run_of_four_of_one_technique_fails(self):
        cues = [bigword(1, drop=True), bigword(2, drop=True), bigword(3, drop=True), bigword(4, drop=True),
                {"kind": "meterGauge", "at": 5, "end": 6}, {"kind": "listRows", "at": 6, "end": 7}, {"kind": "flowSteps", "at": 7, "end": 8},
                {"kind": "phoneScreen", "at": 8, "end": 9}, {"kind": "chatThread", "at": 9, "end": 9.5}, {"kind": "tradeScreen", "at": 9.5, "end": 9.9},
                {"kind": "receiptPrint", "at": 16, "end": 17}, {"kind": "stepBars", "at": 17, "end": 18}, {"kind": "footageCard", "at": 18, "end": 19},
                {"kind": "askField", "at": 20, "end": 21}]
        problems, _ = learning.variety_problems(learning.beats(cues, EDL))
        self.assertEqual(problems, ["bigWord:drop three in a row from 1.0s"])

    def test_one_technique_over_thirty_percent_fails(self):
        cues = [bigword(1, drop=True), {"kind": "meterGauge", "at": 2, "end": 3}, bigword(3, drop=True), {"kind": "listRows", "at": 4, "end": 5}]
        problems, _ = learning.variety_problems(learning.beats(cues, EDL))
        self.assertEqual(problems, ["bigWord:drop 50% of beats"])

    def test_labels_grounds_and_captions_ride_along(self):
        cues = [{"kind": kind, "at": 1, "end": 2} for kind in ("chipRail", "paperScene", "caption")]
        self.assertEqual(learning.beats(cues, EDL), [])

    def test_zero_beats_fail(self):
        self.assertEqual(learning.variety_problems([])[0], ["no headline beats"])

    def test_each_big_word_move_and_every_zoom_is_its_own_technique(self):
        cues = [bigword(1, strikeAt=0.2), bigword(2, scribbleAt=0.2), bigword(3, tumble=True), bigword(4, count={"to": 9}),
                bigword(5, slot={"fixed": "a", "words": ["b"]}), bigword(6)]
        edl = {**EDL, "zooms": [{"start": 200, "end": 230, "preset": "push"}]}
        self.assertEqual([name for _, name in learning.beats(cues, edl)],
                         ["bigWord:strike", "bigWord:scribble", "bigWord:tumble", "bigWord:count", "bigWord:slot", "bigWord:rise", "zoom:push"])

    def test_a_cue_wholly_in_cut_footage_is_not_a_beat(self):
        self.assertEqual(learning.beats([bigword(11.0, drop=True)], EDL), [])


class DensityTests(unittest.TestCase):
    def test_a_five_second_gap_in_the_hook_fails(self):
        events = [event(t) for t in (0.5, 2.0, 7.0, 8.5, 10.0, *range(11, 55, 3))]
        problems, _ = learning.density_problems(events, EDL)
        self.assertEqual(problems, ["hook: longest gap 5.00s from 2.00s (limit 2.0s); also 3.00s from 11.00s"])

    def test_a_dense_edit_passes_and_says_how_dense(self):
        events = [event(t * 0.5) for t in range(0, 30)] + [event(t) for t in range(15, 55, 3)]
        problems, summary = learning.density_problems(events, EDL)
        self.assertEqual(problems, [])
        self.assertIn("hook longest gap", summary)

    def test_the_hook_ends_at_the_brand_intro(self):
        # films d176181: the hook is what plays before the intro insert, not the first segment.
        events = [event(t * 0.5) for t in range(0, 11)] + [event(t) for t in range(6, 55, 3)]
        intro = {"at": round(5.2 * 30000 / 1001), "frames": 75}
        self.assertEqual(learning.density_problems(events, EDL, intro=intro)[0], [])
        self.assertEqual(learning.density_problems(events, EDL)[0], ["hook: longest gap 3.00s from 6.00s (limit 2.0s); also 3.00s from 9.00s, 3.00s from 12.00s"])

    def test_a_long_body_gap_fails(self):
        events = [event(t * 0.5) for t in range(0, 30)] + [event(20.0), event(54.0)]
        problems, _ = learning.density_problems(events, EDL)
        self.assertEqual(problems, ["body: longest gap 34.00s from 20.00s (limit 4.0s); also 5.50s from 14.50s"])

    def test_every_gap_over_the_limit_is_named_at_once(self):
        # Naming only the longest, OpenCode fixed one gap per 3.5-min render refusal and met the next.
        events = [event(t * 0.5) for t in range(0, 30)] + [event(t) for t in (15, 25, 28, 31, 40, 43, 46, 49, 52)]
        problems, _ = learning.density_problems(events, EDL)
        self.assertEqual(problems, ["body: longest gap 10.00s from 15.00s (limit 4.0s); also 9.00s from 31.00s"])

    def test_a_cue_that_makes_no_sound_still_counts_as_a_visual(self):
        # A tumble bigWord has no landing sound; one held a 5:30 edit's "NO LIMITS" out of the count.
        events = [event(t * 0.5) for t in range(0, 30)] + [event(20.0), event(54.0)]
        silent = [bigword(t + 5, tumble=True) for t in range(14, 54, 3)]  # source = edited + 5 s in EDL's body
        self.assertEqual(learning.density_problems(events, EDL, silent)[0], [])

    def test_captions_ride_along_and_do_not_count(self):
        events = [event(t * 0.5) for t in range(0, 30)] + [event(20.0), event(54.0)]
        captions = [{"kind": "caption", "at": t + 5, "end": t + 6, "text": "x"} for t in range(14, 54, 3)]
        self.assertEqual(learning.density_problems(events, EDL, captions)[0], ["body: longest gap 34.00s from 20.00s (limit 4.0s); also 5.50s from 14.50s"])

    def test_zooms_count_as_visuals(self):
        edl = {**EDL, "zooms": [{"start": round(t * 30000 / 1001), "end": 0, "preset": "lean"} for t in (x * 1.5 for x in range(37))]}
        self.assertEqual(learning.density_problems([], edl)[0], [])

    def test_an_edit_with_no_visuals_fails_from_its_first_frame(self):
        problems, _ = learning.density_problems([], EDL)
        self.assertTrue(problems[0].startswith("hook: longest gap") and "from 0.00s" in problems[0], problems)


class ThemeTests(unittest.TestCase):
    def setUp(self):
        self.work = Path(tempfile.mkdtemp(prefix="zks-learning-"))
        self.addCleanup(shutil.rmtree, self.work, True)
        patch = mock.patch("zks_engine.qc.inputs.WORK", self.work)
        patch.start()
        self.addCleanup(patch.stop)

    def test_only_the_learning_theme_runs_the_gates(self):
        self.assertFalse(learning.is_learning())
        (self.work / "style.json").write_text(json.dumps({"theme": "minimal"}), encoding="utf-8")
        self.assertFalse(learning.is_learning())
        (self.work / "style.json").write_text(json.dumps({"theme": "learning", "boil": False}), encoding="utf-8")
        self.assertTrue(learning.is_learning())

    @unittest.skipUnless(shutil.which("node"), "needs node")
    def test_the_sheet_is_the_cues_render_js_draws_and_the_intro_split(self):
        (self.work / "edl").mkdir()
        (self.work / "edl" / "v1.json").write_text(json.dumps(EDL), encoding="utf-8")
        write_sheet(self.work, "v1", [bigword(1, drop=True)])
        write_sheet(self.work, "v1-cc", [{"kind": "caption", "at": 1, "end": 2, "text": "x"}])
        cues, split_s = learning.load_sheet("v1")
        self.assertEqual([cue["kind"] for cue in cues], ["bigWord", "caption"])
        self.assertEqual(split_s, 0.5)

    @unittest.skipUnless(shutil.which("node"), "needs node")
    def test_render_refuses_a_thin_sheet_before_drawing_a_frame(self):
        # Density and variety read only the EDL, the SFX sheet and the cues: a 20-min render and a QC to learn them was waste.
        (self.work / "edl").mkdir()
        (self.work / "edl" / "v1.json").write_text(json.dumps(EDL), encoding="utf-8")
        (self.work / "edl" / "v1.sfx.json").write_text(json.dumps({"events": [event(t * 0.5) for t in range(0, 6)]}), encoding="utf-8")
        write_sheet(self.work, "v1", [bigword(1, drop=True)])
        with self.assertRaisesRegex(GateFailed, r"density \(hook: longest gap .*variety \(bigWord:drop 100% of beats"):
            learning.check_sheet("v1")
        dense = [event(t * 0.5) for t in range(0, 30)] + [event(t) for t in range(15, 55, 3)]
        (self.work / "edl" / "v1.sfx.json").write_text(json.dumps({"events": dense}), encoding="utf-8")
        write_sheet(self.work, "v1", [bigword(at, **move) for at, move in zip(range(1, 9), [{"drop": True}, {"tumble": True}, {"slot": ["a"]}, {"count": 3}] * 2)])
        learning.check_sheet("v1")

    @unittest.skipUnless(shutil.which("node"), "needs node")
    def test_a_sheet_that_will_not_load_is_a_gate_failure(self):
        (self.work / "edl").mkdir()
        (self.work / "edl" / "v1.json").write_text(json.dumps(EDL), encoding="utf-8")
        (self.work / "cues").mkdir()
        (self.work / "cues" / "v1.json").write_text("[{", encoding="utf-8")
        with self.assertRaisesRegex(GateFailed, "not valid JSON"):
            learning.load_sheet("v1")


if __name__ == "__main__":
    unittest.main()
