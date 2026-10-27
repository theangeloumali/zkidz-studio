# Created by The Angelo Umali.
# The HyperFrames bridge: overlay/timemap.js maps cues exactly as the canvas page does, and hf/build.js writes a
# composition whose clips sit on the edit's frame grid.
import json
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

from support import ENGINE, GALLERY, GALLERY_FRAMES, hf_installed, make_edl, needs_renderer, scratch_work, seconds, write_sheet  # first: it sets a scratch ZKS_HOME

# Source frames 300-330 (10.01-11.011 s) are a trimmed pause; the reel also loses everything before frame 150 (5.005 s).
FULL = make_edl([(0, 300), (330, 600)])
REEL = {**make_edl([(150, 300), (330, 600)]), "reel": True}
PAUSE = seconds(30)
CUES = [
    {"kind": "criteriaCard", "at": 8, "end": 14, "title": "Rows", "rows": [{"text": "one", "at": 1}, {"text": "two", "at": 4}]},
    {"kind": "titleSwap", "at": 4.5, "end": 9.5, "old": "old", "new": "new", "swapAt": 1},
    {"kind": "keyword", "at": 9.8, "end": 11.2, "text": "mostly cut"},
]
# The bleep and the "gone" cutaway lie wholly inside the trimmed pause; the authored keyword beside them must still warn.
# "squeezed" is a 0.3 s card cutaway, too short for its title, so it draws as a bare wipe. Every cutaway covers its
# whole span and wipes out after it, so its swishOut lands on its end.
DERIVED = {**FULL, "bleeps": [{"at": 10.3, "end": 10.6, "x": 540, "y": 900}],
           "cutaways": [{"at": 2.0, "end": 3.0, "title": "kept"}, {"at": 6.0, "end": 6.3, "title": "squeezed"},
                        {"at": 10.1, "end": 10.9, "title": "gone", "style": "wipe"}]}
DERIVED_CUES = [{"kind": "keyword", "at": 10.3, "end": 10.6, "text": "in the pause"}]


# Reads {edl, cueSheet, includeDerived} on stdin, prints the mapped cues + warnings.
TIMEMAP_PROBE = """
const { createTimemap } = require(process.argv[1]);
const { edl, cueSheet, includeDerived } = JSON.parse(require("fs").readFileSync(0, "utf8"));
const warnings = [];
const cues = createTimemap(edl, warnings).mapCues(cueSheet, { includeDerived });
console.log(JSON.stringify({ cues, warnings }));
"""


def map_cues(edl, cue_sheet, include_derived=False):
    result = subprocess.run(["node", "-e", TIMEMAP_PROBE, str(ENGINE / "hf" / "overlay" / "timemap.js")], capture_output=True,
                            text=True, encoding="utf-8", input=json.dumps({"edl": edl, "cueSheet": cue_sheet,
                                                                           "includeDerived": include_derived}))
    if result.returncode:
        raise AssertionError(result.stderr)
    return json.loads(result.stdout)


@needs_renderer(hf_installed())
class TimemapTests(unittest.TestCase):
    def cue(self, mapped, kind):
        return next(cue for cue in mapped["cues"] if cue["kind"] == kind)

    def test_a_row_after_a_trimmed_pause_stays_on_its_word(self):
        card = self.cue(map_cues(FULL, CUES), "criteriaCard")
        self.assertAlmostEqual(card["start"], 8.0, places=6)
        self.assertAlmostEqual(card["stop"], 14 - PAUSE, places=6)
        self.assertEqual([round(row["at"], 6) for row in card["rows"]], [1.0, round(4 - PAUSE, 6)])

    def test_reel_drops_a_mostly_cut_cue_with_the_canvas_warning(self):
        mapped = map_cues(REEL, CUES)
        self.assertNotIn("keyword", [cue["kind"] for cue in mapped["cues"]])
        self.assertTrue(any(w.startswith('keyword "mostly cut" @9.8s dropped from the reel') for w in mapped["warnings"]))

    def test_reel_clamps_a_headless_cue_and_keeps_its_pin(self):
        swap = self.cue(map_cues(REEL, CUES), "titleSwap")
        self.assertAlmostEqual(swap["start"], 0.0, places=6)
        self.assertAlmostEqual(swap["swapAt"], 5.5 - seconds(150), places=6)

    def test_derived_cues_load_only_when_asked_and_vanish_on_removed_footage(self):
        self.assertEqual([cue["kind"] for cue in map_cues(DERIVED, DERIVED_CUES)["cues"]], ["keyword"])
        mapped = map_cues(DERIVED, DERIVED_CUES, include_derived=True)
        self.assertEqual(sorted(cue["kind"] for cue in mapped["cues"]), ["cutaway", "cutaway", "keyword"])
        self.assertIn('keyword "in the pause" @10.3s snapped to next kept frame', mapped["warnings"])

    def test_seeds_follow_the_mapped_order(self):
        self.assertEqual([cue["seed"] for cue in map_cues(FULL, CUES)["cues"]], [9001, 9002, 9003])


FPS = 30000 / 1001
BAD_CUES = [{"kind": "nope", "at": 1, "end": 2}]
# Unpinned pills take the canvas stagger (start 0.45, step 0.3); captions 0.2 s apart swap in place (canvas CAPTION_JOIN 0.3).
PARITY_CUES = [
    {"kind": "pills", "at": 2, "end": 6, "text": "Pills", "items": [{"text": "A"}, {"text": "B"}, {"text": "C"}]},
    {"kind": "caption", "at": 1, "end": 3, "text": "First line"},
    {"kind": "caption", "at": 3.2, "end": 5, "text": "Second line"},
]


def first_frame(seconds_value):
    return int(-(-(seconds_value * FPS - 1e-6) // 1))  # ceil, as the canvas draws frame n once n / fps >= start


def build(work, target, *args):
    return subprocess.run(["node", str(ENGINE / "hf" / "build.js"), target, *args], cwd=work, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", env={**os.environ, "ZKS_WORK": str(work)}, timeout=120)


@needs_renderer(hf_installed())
class BuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        cls.work = Path(cls.folder.name)
        (cls.work / "edl").mkdir()
        (cls.work / "cues").mkdir()
        write_sheet(cls.work, "timing", CUES)
        write_sheet(cls.work, "bad", BAD_CUES)
        for video, edl in (("full", FULL), ("reel", REEL)):
            (cls.work / "edl" / f"{video}.json").write_text(json.dumps(edl), encoding="utf-8")
        cls.full = build(cls.work, "full:timing", "--events")
        cls.reel = build(cls.work, "reel:timing")
        cls.html = (cls.work / "hf" / "full--timing" / "index.html").read_text(encoding="utf-8")
        cls.cues = json.loads((cls.work / "hf" / "full--timing" / "cues.json").read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    def clip(self, kind):
        cue = next(cue for cue in self.cues if cue["kind"] == kind)
        match = re.search(rf'id="{cue["id"]}" class="clip" data-start="([\d.]+)" data-duration="([\d.]+)"', self.html)
        return cue, float(match.group(1)), float(match.group(2))

    def test_builds_without_errors(self):
        self.assertEqual(self.full.returncode, 0, self.full.stderr)
        self.assertEqual(self.reel.returncode, 0, self.reel.stderr)

    def test_root_duration_is_the_edit_length(self):
        duration = float(re.search(r'data-composition-id="[^"]+" data-start="0" data-duration="([\d.]+)"', self.html).group(1))
        self.assertAlmostEqual(duration, FULL["frames"] * 1001 / 30000, places=8)

    def test_clips_cover_exactly_the_frames_the_canvas_draws(self):
        cue, start, duration = self.clip("criteriaCard")
        first, end = first_frame(8.0), first_frame(14 - PAUSE)
        self.assertAlmostEqual(start, (first - 0.25) / FPS, places=6)  # a quarter frame early: no float flips at the edge
        self.assertAlmostEqual(duration, (end - first) / FPS, places=6)
        self.assertEqual((cue["firstFrame"], cue["endFrame"]), (first, end))

    def test_every_tween_starts_on_the_frame_grid(self):
        specs = json.loads(re.search(r'<script type="application/json" id="hf-tweens">(.*?)</script>', self.html, re.S).group(1))
        self.assertTrue(specs)
        for spec in specs:
            self.assertAlmostEqual(spec["at"] * FPS, round(spec["at"] * FPS), places=4, msg=spec)

    def test_events_keep_row_checks_on_their_words(self):
        events = json.loads((self.work / "edl" / "full.sfx.json").read_text(encoding="utf-8"))
        self.assertEqual(events["frames"], FULL["frames"])
        checks = [event["time"] for event in events["events"] if event["kind"] == "criteriaCard" and event["sound"] == "check"]
        self.assertEqual([round(time, 4) for time in checks], [9.25, round(12.25 - PAUSE, 4)])  # test_cue_timing's canvas times

    def test_reel_drops_a_mostly_cut_cue_with_the_canvas_warning(self):
        self.assertIn('CUE WARNING: keyword "mostly cut" @9.8s dropped from the reel', self.reel.stderr)
        reel_cues = json.loads((self.work / "hf" / "reel--timing" / "cues.json").read_text(encoding="utf-8"))
        self.assertNotIn("keyword", [cue["kind"] for cue in reel_cues])

    def test_an_unknown_kind_fails_and_lists_the_supported_ones(self):
        result = build(self.work, "full:bad")
        self.assertEqual(result.returncode, 1)
        self.assertIn("nope: unknown component", result.stderr)
        self.assertIn("hookTitle", result.stderr)
        self.assertNotIn("OVERLAYS=canvas", result.stderr)

    def test_a_canvas_only_kind_fails_without_naming_a_renderer_this_engine_lacks(self):
        write_sheet(self.work, "older", [{"kind": "terminalCard", "at": 1, "end": 3, "lines": ["ls"]}])
        result = build(self.work, "full:older")
        self.assertEqual(result.returncode, 1)
        self.assertIn("unknown cue kinds: terminalCard", result.stderr)
        self.assertNotIn("OVERLAYS=canvas", result.stderr)

    def test_unpinned_items_and_caption_joins_match_the_canvas_page(self):
        write_sheet(self.work, "parity", PARITY_CUES)
        (self.work / "edl" / "parity.json").write_text(json.dumps(FULL), encoding="utf-8")
        result = build(self.work, "parity", "--events")
        self.assertEqual(result.returncode, 0, result.stderr)
        events = json.loads((self.work / "edl" / "parity.sfx.json").read_text(encoding="utf-8"))["events"]
        ticks = [round(event["time"], 4) for event in events if event["kind"] == "pills" and event["sound"] == "tick"]
        self.assertEqual(ticks, [round(2 + 0.45 + index * 0.3 + 0.05, 4) for index in range(3)])
        html = (self.work / "hf" / "parity" / "index.html").read_text(encoding="utf-8")
        specs = json.loads(re.search(r'id="hf-tweens">(.*?)</script>', html, re.S).group(1))
        placed = json.loads((self.work / "hf" / "parity" / "cues.json").read_text(encoding="utf-8"))
        first, second = [cue["id"] for cue in placed if cue["kind"] == "caption"]
        fades_out = [spec for spec in specs if spec["target"] == f"#{first} .plate" and spec["to"].get("opacity") == 0]
        self.assertFalse(fades_out, "a caption joined to the next must not fade out")
        fades_in = [spec for spec in specs if spec["target"] == f"#{second} .plate" and spec.get("from", {}).get("opacity") == 0]
        self.assertFalse(fades_in, "a caption joined to the last must not fade in")


TWEEN_KEYS = {"duration", "ease", "stagger", "clearProps", "immediateRender", "yoyo", "repeat", "repeatDelay"}


def assert_seek_safe(case, specs):
    """When two tweens share an element's property, every later one is a fromTo that does not render early."""
    seen = {}
    for spec in sorted((spec for spec in specs if "target" in spec), key=lambda spec: spec["at"]):
        props = (set(spec.get("to", {})) | set(spec.get("set", {}))) - TWEEN_KEYS
        for prop in props:
            key = (spec["target"], prop)
            if key in seen:
                case.assertIn("from", spec, f"{key}: a later tween must state its start value")
                case.assertIs(spec["to"].get("immediateRender"), False, f"{key}: a later fromTo must not render early")
            seen[key] = spec


def tweens(html):
    return json.loads(re.search(r'id="hf-tweens">(.*?)</script>', html, re.S).group(1))


@needs_renderer(hf_installed())
class SeekSafetyTests(unittest.TestCase):
    """HyperFrames workers seek to frames in any order, so a tween's start value must never depend on what rendered
    before it: when two tweens share an element's property, every later one is a fromTo that does not render early."""

    def test_shared_properties_are_only_ever_animated_from_explicit_values(self):
        with tempfile.TemporaryDirectory() as folder:
            work = scratch_work(folder, "gallery", make_edl([(0, GALLERY_FRAMES)]), GALLERY)
            self.assertEqual(build(work, "gallery").returncode, 0)
            html = (work / "hf" / "gallery" / "index.html").read_text(encoding="utf-8")
        assert_seek_safe(self, tweens(html))


END_CARD_CUES = [{"kind": "endCard", "at": 1, "end": 9, "cta": "Follow"}]


@needs_renderer(hf_installed())
class TypedCursorTests(unittest.TestCase):
    """The end card's call to action types, then its cursor blinks as the canvas typeOn draws it: on for the first
    half of every 0.5 s after the last letter, off for the second."""

    def test_the_idle_cursor_alternates_off_and_on_every_quarter_second(self):
        with tempfile.TemporaryDirectory() as folder:
            work = scratch_work(folder, "card", make_edl([(0, 300)]), END_CARD_CUES)
            self.assertEqual(build(work, "card").returncode, 0)
            html = (work / "hf" / "card" / "index.html").read_text(encoding="utf-8")
        blinks = sorted((spec["at"], spec["to"]["opacity"]) for spec in tweens(html) if spec["target"].endswith(" .cta-cursor") and "opacity" in spec.get("to", {}))
        done = 1 + 1.1 + len("Follow") / 20  # cue start + END_CARD.ctaAt + letters / cps
        self.assertGreater(len(blinks), 4)
        for index, (at, opacity) in enumerate(blinks):
            self.assertAlmostEqual(at, done + 0.25 * (index + 1), delta=1 / FPS, msg=blinks)
            self.assertEqual(opacity, 0 if index % 2 == 0 else 1, blinks)


def intro_hook(at, **fields):
    return {"kind": "hookTitle", "at": at, "end": 5, "intro": True, "kicker": "How I ask", "lines": ["From $12", "to $25."], "accentLine": 1, **fields}


INTRO_CUES = [intro_hook(0)]
LATE_INTRO_CUES = [intro_hook(1)]
# A card 0.2 s after the hook's end, and a caption there (speech-locked, never moved).
CARD_CUES = [intro_hook(0), {"kind": "keyword", "at": 5.2, "end": 7.2, "text": "Later", "tone": "paper"},
             {"kind": "caption", "at": 5.2, "end": 6.2, "text": "Said here"}]


@needs_renderer(hf_installed())
class BrandIntroTests(unittest.TestCase):
    """A hookTitle with `intro: true` plays first; the full-screen brand pre-roll goes in when it ends. build.js writes the
    pre-roll's composition and its sounds beside the edit's, and hands sfx.py the hook's end and the split's sounds; once
    sfx.py has snapped the insert (intro.at), the frame render lays the Z-split over the edit from that frame."""

    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        cls.work = work = Path(cls.folder.name)
        (work / "edl").mkdir()
        (work / "cues").mkdir()
        for video in ("opener", "late", "card"):
            (work / "edl" / f"{video}.json").write_text(json.dumps(make_edl([(0, 300)])), encoding="utf-8")
        write_sheet(work, "opener", INTRO_CUES)
        write_sheet(work, "late", LATE_INTRO_CUES)
        write_sheet(work, "card", CARD_CUES)
        cls.result = build(work, "opener", "--events")
        cls.payload = json.loads((work / "edl" / "opener.sfx.json").read_text(encoding="utf-8"))
        cls.html = (work / "hf" / "opener" / "index.html").read_text(encoding="utf-8")
        cls.preroll = (work / "hf" / "opener.intro" / "index.html").read_text(encoding="utf-8")

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    def test_builds(self):
        self.assertEqual(self.result.returncode, 0, self.result.stderr)

    def test_the_hook_sounds_on_its_own_beats(self):
        sounds = [(round(event["time"], 3), event["sound"]) for event in self.payload["events"]]
        self.assertEqual(sounds, [(0.15, "hook"), (0.57, "rule")])

    def test_the_pre_roll_is_two_seconds_with_its_own_sound(self):
        intro = self.payload["intro"]
        self.assertEqual(intro["frames"], 60)
        self.assertEqual([(event["time"], event["sound"]) for event in intro["events"]], [(0, "intro")])
        self.assertIn('data-duration="2.002000000"', self.preroll)

    def test_sfx_gets_the_hooks_end_and_the_splits_sounds(self):
        intro = self.payload["intro"]
        self.assertAlmostEqual(intro["hookEnd"], 5.0, delta=1 / FPS)
        self.assertEqual([(event["time"], event["sound"]) for event in intro["splitEvents"]], [(0, "whipOut")])

    def test_the_frame_render_lays_the_split_over_the_edit_at_the_insert(self):
        payload = {**self.payload, "intro": {**self.payload["intro"], "at": 150}}
        (self.work / "edl" / "opener.sfx.json").write_text(json.dumps(payload), encoding="utf-8")
        self.assertEqual(build(self.work, "opener").returncode, 0)
        html = (self.work / "hf" / "opener" / "index.html").read_text(encoding="utf-8")
        self.assertEqual(html.count('class="intro-half intro-upper"'), 1)
        self.assertIn('src="brand/zkidz-dev-logo.png"', html)
        split = re.search(r'data-start="([\d.]+)"[^>]*>(?:(?!data-start).)*intro-upper', html, re.S)
        self.assertIsNotNone(split, "no clip holds the split")
        self.assertAlmostEqual(float(split.group(1)), 150 / FPS, delta=0.5 / FPS)
        assert_seek_safe(self, tweens(html))

    def test_the_master_logo_ships_with_both_compositions(self):
        # The frame render draws it once the insert is known (the test above).
        for folder in ("opener", "opener.intro"):
            self.assertTrue((self.work / "hf" / folder / "brand" / "zkidz-dev-logo.png").exists(), folder)
        self.assertIn('src="brand/zkidz-dev-logo.png"', self.preroll)

    def test_every_tween_is_seek_safe(self):
        for html in (self.html, self.preroll):
            assert_seek_safe(self, tweens(html))

    def test_sfx_gets_the_cards_that_may_wait_and_each_sound_its_cue(self):
        self.assertEqual(build(self.work, "card", "--events").returncode, 0)
        payload = json.loads((self.work / "edl" / "card.sfx.json").read_text(encoding="utf-8"))
        self.assertEqual([(card["kind"], round(card["start"], 2)) for card in payload["intro"]["cards"]], [("keyword", 5.2)])
        self.assertTrue(all("cueStart" in event for event in payload["events"]))

    def test_a_card_before_the_insert_waits_for_it(self):
        self.assertEqual(build(self.work, "card", "--events").returncode, 0)
        events = self.work / "edl" / "card.sfx.json"
        payload = json.loads(events.read_text(encoding="utf-8"))
        intro = {**payload["intro"], "at": 180, "deferred": payload["intro"]["cards"]}
        events.write_text(json.dumps({**payload, "intro": intro}), encoding="utf-8")
        self.assertEqual(build(self.work, "card").returncode, 0)
        placed = {cue["kind"]: cue for cue in json.loads((self.work / "hf" / "card" / "cues.json").read_text(encoding="utf-8"))}
        self.assertAlmostEqual(placed["keyword"]["start"], 180 / FPS, delta=1e-6)
        self.assertAlmostEqual(placed["keyword"]["stop"] - placed["keyword"]["start"], 2.0, delta=1 / FPS)
        self.assertAlmostEqual(placed["caption"]["start"], 5.2, delta=1 / FPS)

    def test_after_a_cold_open_the_insert_waits_for_its_end(self):
        # introAt is a pin after the hook's at: where a vlog-style cold open ends. Never before the hook has gone.
        for video, intro_at, expected in (("coldopen", 8, 8.0), ("early", 3, 5.0)):
            (self.work / "edl" / f"{video}.json").write_text(json.dumps(make_edl([(0, 300)])), encoding="utf-8")
            write_sheet(self.work, video, [intro_hook(0, introAt=intro_at)])
            self.assertEqual(build(self.work, video, "--events").returncode, 0)
            intro = json.loads((self.work / "edl" / f"{video}.sfx.json").read_text(encoding="utf-8"))["intro"]
            self.assertAlmostEqual(intro["hookEnd"], expected, delta=1 / FPS, msg=video)

    def test_a_later_intro_hook_is_fine(self):
        late = build(self.work, "late", "--events")
        self.assertEqual(late.returncode, 0, late.stderr)
        self.assertAlmostEqual(json.loads((self.work / "edl" / "late.sfx.json").read_text(encoding="utf-8"))["intro"]["hookEnd"], 5.0, delta=1 / FPS)

    def test_the_intro_alone_composes_in_landscape_and_stays_seek_safe(self):
        out = self.work / "alone"
        script = (f"require({json.dumps(str(ENGINE / 'hf' / 'build'))}).brandIntroCompositions('landscape', "
                  f"{{ fps_num: 30000, fps_den: 1001 }}, {json.dumps(str(out))})")
        subprocess.run(["node", "-e", script], check=True, capture_output=True, env={**os.environ, "ZKS_WORK": str(self.work)})
        for name, duration in (("preroll", "2.002000000"), ("split", "0.533866667")):
            html = (out / name / "index.html").read_text(encoding="utf-8")
            self.assertIn(f'data-duration="{duration}" data-width="1920" data-height="1080"', html, name)
            assert_seek_safe(self, tweens(html))

    def test_a_sheet_without_an_intro_has_no_pre_roll(self):
        write_sheet(self.work, "plain", [intro_hook(0, intro=False)])
        (self.work / "edl" / "plain.json").write_text(json.dumps(make_edl([(0, 300)])), encoding="utf-8")
        self.assertEqual(build(self.work, "plain", "--events").returncode, 0)
        self.assertNotIn("intro", json.loads((self.work / "edl" / "plain.sfx.json").read_text(encoding="utf-8")))
        self.assertFalse((self.work / "hf" / "plain.intro").exists())


@needs_renderer(hf_installed())
class RenderFailureTests(unittest.TestCase):
    """A failed hyperframes run names its output and how it ended, even when its stderr is empty."""

    def failure(self, error):
        script = (f"const {{ failureText }} = require({json.dumps(str(ENGINE / 'hf' / 'render'))});"
                  f"const e = {error}; process.stdout.write(failureText(e));")
        return subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout

    def test_an_empty_stderr_falls_back_to_the_error_and_its_exit(self):
        text = self.failure('{ stderr: Buffer.alloc(0), stdout: Buffer.alloc(0), message: "Command failed: hyperframes render", status: 3 }')
        self.assertIn("Command failed: hyperframes render", text)
        self.assertIn("exit code 3", text)

    def test_a_killed_render_says_so(self):
        self.assertIn("killed by SIGTERM", self.failure('{ stderr: Buffer.alloc(0), message: "Command failed", status: null, signal: "SIGTERM" }'))

    def test_the_capture_lines_give_the_frames_drawn(self):
        script = (f"const {{ framesCaptured }} = require({json.dumps(str(ENGINE / 'hf' / 'render'))});"
                  "process.stdout.write(String(framesCaptured('  33%  Capturing frame 173/995 (8 workers)\\r  40%  Capturing frame 401/995')))")
        self.assertEqual(subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout, "401")

    def test_stderr_comes_first(self):
        self.assertTrue(self.failure('{ stderr: Buffer.from("Chrome crashed"), message: "Command failed", status: 1 }').startswith("Chrome crashed"))


@needs_renderer(hf_installed())
class CliAndMarkupTests(unittest.TestCase):
    """The brand-intro CLI refuses a missing or malformed flag instead of guessing (its --out folders are emptied), and
    the stat odometer escapes the text it writes into SVG."""

    def node(self, *args):
        return subprocess.run(["node", *args], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)

    def test_the_brand_intro_cli_needs_out_and_an_n_over_d_rate(self):
        render = str(ENGINE / "hf" / "render.js")
        missing = self.node(render, "--brand-intro", "landscape", "--fps", "30000/1001")
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn("--out is required", missing.stderr)
        with tempfile.TemporaryDirectory() as folder:
            bare = self.node(render, "--brand-intro", "landscape", "--fps", "30", "--out", folder)
        self.assertNotEqual(bare.returncode, 0)
        self.assertIn("--fps is N/D", bare.stderr)

    def test_an_unknown_orientation_is_refused(self):
        build_js = json.dumps(str(ENGINE / "hf" / "build"))
        result = self.node("-e", f"require({build_js}).brandIntroCompositions('sideways', {{ fps_num: 30, fps_den: 1 }}, '.')")
        self.assertIn("the orientation is portrait or landscape, not sideways", result.stderr)

    def test_a_shrunk_plain_label_is_revealed_over_its_fitted_width(self):
        parts, ink = json.dumps(str(ENGINE / "hf" / "components" / "parts")), json.dumps(str(ENGINE / "hf" / "fx" / "ink"))
        script = (f"const parts = require({parts}); const {{ penReveal }} = require({ink}); const k = parts.k;"
                  "const font = { ...k.TYPE.hand, size: 50 }; const text = 'Applies while I sleep';"
                  "const options = { plain: true, align: 'center', maxWidth: 290, wobble: 0.6 };"
                  "const got = parts.written({ kind: 'pipeline', seed: 1 }, 'w', text, 540, 350, font, [0, 1], options).motion[0].to.clipPath;"
                  "const fitted = { ...font, size: k.fitFontSize(text, { ...font, maxWidth: 290, wobble: 0.6, align: 'center' }, 290) };"
                  "const [l, t, w, h] = k.strokedRevealBox(text, fitted, 'center');"
                  "const want = penReveal('.w', [0, 1], [540 + l, 350 + t, 540 + l + w, 350 + t + h]).to.clipPath;"
                  "console.log(fitted.size < 50 && got === want ? 'ok' : `bad ${fitted.size} ${got} vs ${want}`);")
        result = self.node("-e", script)
        self.assertEqual(result.stdout.strip(), "ok", result.stdout + result.stderr)

    def test_the_odometer_escapes_its_characters(self):
        kinetic = json.dumps(str(ENGINE / "hf" / "fx" / "kinetic"))
        script = (f"const {{ odometer }} = require({kinetic});"
                  "const font = { family: 'Newsreader', size: 100, weight: 600 };"
                  "console.log(odometer('n', { text: '<9', right: 500, baseline: 500, font, colour: '#000', at: 0, roll: {}, idPrefix: 'x' }).html);")
        html = self.node("-e", script)
        self.assertEqual(html.returncode, 0, html.stderr)
        self.assertIn(">&lt;</text>", html.stdout)
        self.assertNotIn("><</text>", html.stdout)


VLOG_CUES = [
    {"kind": "chatCard", "at": 1, "end": 9, "title": "Me to the editor", "typing": True, "stream": True, "accentPhrase": "every skill",
     "messages": [{"from": "me", "text": "Use every skill you have", "at": 0.6}, {"from": "editor", "text": "Reading the skills now", "at": 2.0}]},
    {"kind": "headlineStack", "at": 10, "end": 17, "final": "So I built my own", "finalAt": 4.2,
     "items": [{"text": "Facebook: slow upload", "at": 0.3}, {"text": "Then I still schedule", "at": 1.5}]},
    {"kind": "lineChart", "at": 18, "end": 25, "kicker": "CPU", "title": "ffmpeg load", "note": "busy for 45 min", "suffix": "%", "focus": 2,
     "points": [["0m", 12], ["15m", 48], ["30m", 95], ["45m", 60]]},
    {"kind": "phoneFrame", "at": 26, "end": 32, "tilt": -6},
]
TEXT_NODE = re.compile(r'style="white-space:pre">([^<]*)</text>')


def words_drawn(html, clip_id):
    """Every word an SVG <text> draws inside clip `clip_id`, in document order."""
    return " ".join(TEXT_NODE.findall(clip_markup(html, clip_id))).split()


def clip_markup(html, clip_id):
    start = html.index(f'id="{clip_id}" class="clip"')
    ends = [index for index in (html.find('class="clip"', start + 20), html.find("<script", start)) if index > 0]
    return html[start:min(ends)]


@needs_renderer(hf_installed())
class VlogKindTests(unittest.TestCase):
    """chatCard, headlineStack, lineChart and phoneFrame: each builds, draws its cue's words and nothing else, and stays
    seek-safe."""

    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        cls.work = scratch_work(cls.folder.name, "vlog", make_edl([(0, 1000)]), VLOG_CUES)
        cls.result = build(cls.work, "vlog", "--events")
        cls.html = (cls.work / "hf" / "vlog" / "index.html").read_text(encoding="utf-8") if cls.result.returncode == 0 else ""
        cls.placed = json.loads((cls.work / "hf" / "vlog" / "cues.json").read_text(encoding="utf-8")) if cls.html else []

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    def clip_of(self, kind):
        self.assertEqual(self.result.returncode, 0, self.result.stderr)
        return next(cue["id"] for cue in self.placed if cue["kind"] == kind)

    def test_the_chat_card_quotes_only_the_cues_words(self):
        drawn = [word.lower() for word in words_drawn(self.html, self.clip_of("chatCard"))]  # the kicker sets the title in caps
        given = "me to the editor use every skill you have reading the skills now".split()
        self.assertTrue(set(given) <= set(drawn), drawn)
        self.assertFalse(set(drawn) - set(given), "the chat card drew words its cue never gave")

    def test_the_reply_streams_word_by_word_and_the_typing_dots_run(self):
        clip = self.clip_of("chatCard")
        words = [spec for spec in tweens(self.html) if spec["target"].startswith(f"#{clip} ") and ".stream" in spec["target"]]
        self.assertTrue(words and all("stagger" in spec["to"] for spec in words), words)
        self.assertIn('class="u dot0', self.html)
        self.assertIn('class="u dot2', self.html)

    def test_the_headline_stack_draws_every_slip_and_turns_the_final_one_gold(self):
        clip = self.clip_of("headlineStack")
        drawn = " ".join(words_drawn(self.html, clip))
        for text in ("Facebook: slow upload", "Then I still schedule", "So I built my own"):
            self.assertIn(text, drawn)
        gold = [spec for spec in tweens(self.html) if spec["target"] == f"#{clip} .final-gold"]
        self.assertTrue(gold, "the final slip never turns gold")

    def test_the_line_chart_draws_its_labels_and_counts_to_the_last_value(self):
        clip = self.clip_of("lineChart")
        drawn = words_drawn(self.html, clip)
        for label in ("0m", "15m", "30m", "45m", "CPU", "ffmpeg", "load", "busy"):
            self.assertIn(label, drawn)
        specs = [spec for spec in tweens(self.html) if spec["target"].startswith(f"#{clip} ")]
        self.assertTrue(any(".line path" in spec["target"] for spec in specs), "the stroke never draws on")
        self.assertTrue(any(".roll" in spec["target"] for spec in specs), "the tip value never counts")

    def test_the_phone_frame_is_an_overlay_with_no_card_or_scrim(self):
        clip = self.clip_of("phoneFrame")
        markup = clip_markup(self.html, clip)
        self.assertIn("bezel", markup)
        self.assertNotIn("scrim", markup)
        self.assertFalse(words_drawn(self.html, clip))

    def test_the_phone_frame_sits_on_the_showcase_portrait_panel(self):
        from zks_engine import showcase
        x, y, w, h = (value / 2 for value in showcase.PANELS["portrait"])
        script = f"console.log(JSON.stringify(require({json.dumps(str(ENGINE / 'hf' / 'components' / 'fx'))}).PORTRAIT_PANEL))"
        panel = json.loads(subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout)
        self.assertEqual(panel, [x, y, w, h])

    def test_every_tween_is_seek_safe_and_every_sound_is_a_known_one(self):
        self.assertEqual(self.result.returncode, 0, self.result.stderr)
        assert_seek_safe(self, tweens(self.html))
        events = json.loads((self.work / "edl" / "vlog.sfx.json").read_text(encoding="utf-8"))["events"]
        from zks_engine import sfx
        self.assertEqual({event["kind"] for event in events}, {"chatCard", "headlineStack", "lineChart", "phoneFrame"})
        self.assertFalse({event["sound"] for event in events} - set(sfx.RECIPES))


@needs_renderer(hf_installed())
class DeterminismTests(unittest.TestCase):
    """Seeded sketch, particles and shakes: two builds in separate processes write byte-identical compositions."""

    def test_two_builds_are_byte_identical(self):
        pages = []
        for _ in range(2):
            with tempfile.TemporaryDirectory() as folder:
                work = scratch_work(folder, "gallery", make_edl([(0, GALLERY_FRAMES)]), GALLERY)
                self.assertEqual(build(work, "gallery").returncode, 0)
                pages.append((work / "hf" / "gallery" / "index.html").read_bytes())
        self.assertEqual(pages[0], pages[1])


if __name__ == "__main__":
    unittest.main()
