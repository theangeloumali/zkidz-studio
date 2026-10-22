# Created by The Angelo Umali.
# Unit tests for sfx.py: recipe levels at 48 kHz, determinism, mix guards and an end-to-end mix of a tiny edit.
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
from support import make_edl, seconds  # first: it sets a scratch ZKS_HOME

from zks_engine import pipeline, sfx


def level(dbfs):
    return 10 ** (dbfs / 20)


class RecipeTests(unittest.TestCase):
    def render(self, sound, **event):
        return sfx.render_event({"time": 1.0, "sound": sound, **event})[1]

    def test_synth_runs_at_48k(self):
        self.assertEqual(sfx.synth.RATE, 48000)
        self.assertEqual(len(self.render("tick")), int(0.03 * 48000))

    def test_single_layer_sounds_peak_at_their_level(self):
        for sound, dbfs in (("swish", -30), ("swishOut", -36), ("tick", -30), ("rule", -34), ("hook", -24), ("nodeGold", -26)):
            self.assertAlmostEqual(np.abs(self.render(sound)).max(), level(dbfs), msg=sound)

    def test_every_sound_stays_under_its_summed_layers(self):
        for sound, recipe in sfx.RECIPES.items():
            layers = recipe(0.4)
            self.assertLessEqual(np.abs(self.render(sound, dur=0.4)).max(), sum(level(layer.dbfs) for layer in layers) * np.sqrt(2) + 1e-9, sound)

    def test_same_event_renders_identically_and_time_reseeds(self):
        np.testing.assert_array_equal(self.render("scratch", dur=0.5), self.render("scratch", dur=0.5))
        other = sfx.render_event({"time": 2.0, "sound": "scratch", "dur": 0.5})[1]
        self.assertFalse(np.array_equal(self.render("scratch", dur=0.5), other))

    def test_thud_leads_in_before_its_slam(self):
        start, _ = sfx.render_event({"time": 1.0, "sound": "thud"})
        self.assertAlmostEqual(start, 0.82)

    def test_span_sounds_follow_dur_and_count_settles_at_the_end(self):
        self.assertGreater(len(self.render("pencil", dur=1.4)), len(self.render("pencil", dur=0.3)) + 48000)
        layers = sfx.count(0.8)
        self.assertEqual(layers[-1].offset, 0.8)
        self.assertGreater(layers[-2].offset - layers[-3].offset, layers[1].offset - layers[0].offset)

    def test_pan_and_gain(self):
        hard_right = self.render("tick", pan=1)
        self.assertAlmostEqual(np.abs(hard_right[:, 0]).max(), 0.0)
        self.assertAlmostEqual(np.abs(self.render("tick", gain=6)).max(), level(-24))


class MixGuardTests(unittest.TestCase):
    def test_audible_drops_events_near_bleeps_and_crowded_starts(self):
        events = [{"time": time, "sound": "tick"} for time in (4.0, 1.0, 1.1, 1.3, 5.25, 6.0)]
        kept = sfx.audible(events, [(5.0, 5.4)])
        self.assertEqual([event["time"] for event in kept], [1.0, 1.3, 4.0, 6.0])

    def test_events_exactly_min_gap_apart_survive_float_noise(self):
        # lowerThird's nodeSteel and pencil, authored 0.25 s apart, on a cue starting at edited frame 18.
        start = 18 * 1001 / 30000
        events = [{"time": start + 0.15, "sound": "nodeSteel"}, {"time": start + 0.4, "sound": "pencil"}]
        self.assertLess(events[1]["time"] - events[0]["time"], sfx.MIN_GAP)
        self.assertEqual(len(sfx.audible(events, [])), 2)

    def test_negative_start_is_clamped_not_wrapped(self):
        bus = sfx.mix_bus([{"time": -0.1, "sound": "swish"}], np.zeros((48000, 2)))
        self.assertFalse(bus[-4800:].any())
        self.assertTrue(bus[:4800].any())

    def test_event_past_the_end_is_truncated(self):
        self.assertEqual(len(sfx.mix_bus([{"time": 0.99, "sound": "sign"}], np.zeros((48000, 2)))), 48000)

    def test_event_survives_speech_peaking_at_the_loudnorm_ceiling(self):
        # loudnorm leaves speech peaking at -1.5 dBFS; a peak-plus-peak cap muted 24 of 72 v4r events (QC 2026-09-26).
        time = np.arange(48000) / 48000
        speech = 10 ** (-1.5 / 20) * np.sin(2 * np.pi * 180 * time) * np.abs(np.sin(2 * np.pi * 3 * time))
        voice = np.stack([speech, speech], axis=1)
        alone = sfx.mix_bus([{"time": 0.2, "sound": "thud"}], np.zeros_like(voice))
        bus = sfx.mix_bus([{"time": 0.2, "sound": "thud"}], voice)
        # A sustained sine at the ceiling is harsher than speech; the event must still sound (the old cap gave exactly 0).
        self.assertGreater(np.abs(bus).max(), 0.25 * np.abs(alone).max())
        self.assertLessEqual(np.abs(voice + bus).max(), sfx.HEADROOM + 1e-9)

    def test_event_is_capped_under_loud_speech(self):
        voice = np.full((48000, 2), 0.7)
        bus = sfx.mix_bus([{"time": 0.2, "sound": "thud"}], voice)
        self.assertLessEqual(np.abs(voice + bus).max(), sfx.HEADROOM + 1e-9)
        silent = sfx.mix_bus([{"time": 0.2, "sound": "thud"}], np.full((48000, 2), sfx.HEADROOM))
        self.assertFalse(silent.any())


@unittest.skipUnless(shutil.which("ffmpeg"), "needs ffmpeg")
class MixTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.work = Path(folder.name)
        for sub in ("audio", "edl"):
            (self.work / sub).mkdir()
        for module in (sfx, pipeline):
            patcher = mock.patch.object(module, "WORK", self.work)
            patcher.start()
            self.addCleanup(patcher.stop)
        timeline = {**make_edl([(0, 90)]), "bleeps": [{"at": seconds(60), "end": seconds(66)}]}
        (self.work / "edl" / "t.json").write_text(json.dumps(timeline), encoding="utf-8")
        self.samples = pipeline.frame_to_sample(timeline["frames"], timeline)
        tone = 0.1 * np.sin(2 * np.pi * 220 * np.arange(self.samples) / 48000)
        sfx.write_wav(self.work / "audio" / "t_edit.wav", np.column_stack([tone, tone]))
        events = [{"time": 0.2, "sound": "hook"}, {"time": 1.0, "sound": "count", "dur": 0.6}, {"time": 2.05, "sound": "tick"}]
        self.write_events({"frames": timeline["frames"], "events": events})

    def write_events(self, payload):
        (self.work / "edl" / "t.sfx.json").write_text(json.dumps(payload), encoding="utf-8")

    def test_mix_keeps_length_and_loudness_and_is_deterministic(self):
        sfx.main("t")
        mix_path = self.work / "audio" / "t_mix.wav"
        first = mix_path.read_bytes()
        mix = sfx.read_wav(mix_path)
        self.assertEqual(len(mix), self.samples)
        self.assertTrue((mix != sfx.read_wav(self.work / "audio" / "t_edit.wav")).any())
        edit_lufs, _ = sfx.loudness(self.work / "audio" / "t_edit.wav")
        mix_lufs, true_peak = sfx.loudness(mix_path)
        self.assertLessEqual(abs(mix_lufs - edit_lufs), sfx.GATE_LU)
        self.assertLessEqual(true_peak, sfx.GATE_TRUE_PEAK)
        sfx.main("t")
        self.assertEqual(mix_path.read_bytes(), first)

    def test_events_for_another_edit_are_refused(self):
        self.write_events({"frames": 12, "events": []})
        with self.assertRaises(SystemExit):
            sfx.main("t")

    def test_unknown_sound_is_refused(self):
        self.write_events({"frames": 90, "events": [{"time": 1.0, "sound": "kazoo"}]})
        with self.assertRaises(SystemExit):
            sfx.main("t")

    def test_the_intro_goes_in_at_the_pause_after_the_hooks_end(self):
        # The voice pauses for the 2 s intro, so the insert waits for the speaker's pause.
        voice = sfx.read_wav(self.work / "audio" / "t_edit.wav")
        voice[int(2.2 * 48000):int(2.3 * 48000)] = 0
        sfx.write_wav(self.work / "audio" / "t_edit.wav", voice)
        intro = {"frames": 60, "events": [{"time": 0, "sound": "intro", "pan": 0, "gain": 0}], "hookEnd": 2.0,
                 "splitEvents": [{"time": 0, "sound": "whipOut", "pan": 0, "gain": 0}], "cards": []}
        self.write_events({"frames": 90, "events": [], "intro": intro})
        sfx.main("t")
        at = json.loads((self.work / "edl" / "t.sfx.json").read_text(encoding="utf-8"))["intro"]["at"]
        self.assertLessEqual(abs(seconds(at) - 2.25), 0.05)

    def voice_with_gaps(self, *gaps):
        voice = 0.1 * np.ones((self.samples, 2)) * np.sin(2 * np.pi * 220 * np.arange(self.samples) / 48000)[:, None]
        for start, end in gaps:
            voice[int(start * 48000):int(end * 48000)] = 0
        return voice, json.loads((self.work / "edl" / "t.json").read_text(encoding="utf-8"))

    def test_the_intro_never_goes_in_before_the_hook_has_gone(self):
        voice, edl = self.voice_with_gaps((1.6, 1.9), (2.5, 2.7))
        self.assertLessEqual(abs(seconds(sfx.insert_frame(voice, 2.0, edl)) - 2.55), 1 / 30)

    def test_through_continuous_speech_the_intro_takes_the_cleanest_word_gap(self):
        voice, edl = self.voice_with_gaps((2.6, 2.65))
        self.assertLessEqual(abs(seconds(sfx.insert_frame(voice, 2.0, edl)) - 2.625), 1 / 30)

    def test_the_insert_is_never_a_frame_the_hook_still_holds(self):
        # A pause centred on a hook end between frames would round to the frame before it.
        voice, edl = self.voice_with_gaps((2.0, 2.1))
        self.assertEqual(sfx.insert_frame(voice, 2.05, edl), 62)

    def test_on_a_silent_clip_the_intro_goes_in_at_the_hooks_end(self):
        edl = json.loads((self.work / "edl" / "t.json").read_text(encoding="utf-8"))
        self.assertEqual(sfx.insert_frame(np.zeros((self.samples, 2)), seconds(60), edl), 60)

    def test_a_card_before_the_insert_waits_for_it_with_its_sounds(self):
        voice = sfx.read_wav(self.work / "audio" / "t_edit.wav")
        voice[int(2.5 * 48000):int(2.7 * 48000)] = 0
        sfx.write_wav(self.work / "audio" / "t_edit.wav", voice)
        cards = [{"kind": "keyword", "start": 2.1}, {"kind": "keyword", "start": 2.8}]
        intro = {"frames": 60, "events": [{"time": 0, "sound": "intro", "pan": 0, "gain": 0}], "hookEnd": 2.0, "splitEvents": [], "cards": cards}
        events = [{"time": 2.25, "sound": "tick", "kind": "keyword", "cueStart": 2.1}, {"time": 2.9, "sound": "tick", "kind": "keyword", "cueStart": 2.8}]
        self.write_events({"frames": 90, "events": events, "intro": intro})
        sfx.main("t")
        written = json.loads((self.work / "edl" / "t.sfx.json").read_text(encoding="utf-8"))["intro"]
        self.assertEqual(written["deferred"], cards[:1])
        at = seconds(written["at"])
        moved = sfx.defer(events, written["deferred"], at)
        self.assertAlmostEqual(moved[0]["time"], at + 0.15)
        self.assertEqual(moved[1], events[1])
        self.assertEqual(sfx.defer(events, written["deferred"], at), moved)  # the sheet's own times never change

    def test_the_splits_whoosh_survives_a_card_moved_onto_it(self):
        voice = sfx.read_wav(self.work / "audio" / "t_edit.wav")
        voice[int(2.5 * 48000):int(2.7 * 48000)] = 0
        sfx.write_wav(self.work / "audio" / "t_edit.wav", voice)
        intro = {"frames": 60, "events": [], "hookEnd": 2.0, "cards": [{"kind": "keyword", "start": 2.1}],
                 "splitEvents": [{"time": 0, "sound": "whipOut", "pan": 0, "gain": 0}]}
        events = [{"time": 2.04, "sound": "flyIn", "kind": "keyword", "cueStart": 2.1}, {"time": 2.6, "sound": "tick", "kind": "keyword", "cueStart": 2.1}]
        payload = {"frames": 90, "events": events, "intro": intro}
        edl = json.loads((self.work / "edl" / "t.json").read_text(encoding="utf-8"))
        sounds = sfx.place_intro(payload, sfx.read_wav(self.work / "audio" / "t_edit.wav"), edl, self.work / "edl" / "t.sfx.json")
        at = seconds(payload["intro"]["at"])
        self.assertEqual([(round(event["time"] - at, 3), event["sound"]) for event in sounds], [(0.5, "tick"), (0.0, "whipOut")])

    def test_the_brand_intro_gets_its_own_track_at_its_own_loudness(self):
        intro = {"frames": 60, "events": [{"time": 0, "sound": "intro", "pan": 0, "gain": 0}], "hookEnd": 1.0, "splitEvents": [], "cards": []}
        self.write_events({"frames": 90, "events": [], "intro": intro})
        sfx.main("t")
        path = self.work / "audio" / "t_intro.wav"
        self.assertEqual(len(sfx.read_wav(path)), 96096)  # 60 frames at 30000/1001 fps, 48 kHz
        integrated, true_peak = sfx.loudness(path)
        self.assertLessEqual(abs(integrated - sfx.INTRO_LUFS), 1.0)
        self.assertLessEqual(true_peak, sfx.GATE_TRUE_PEAK)
        # A sheet that drops its intro must not leave the old track for render_final to find.
        self.write_events({"frames": 90, "events": []})
        sfx.main("t")
        self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
