# Created by The Angelo Umali.
# music_bed: the cut spec's `music` as an original bed at the edit's length, and the voice + bed + SFX mix's loudness.
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
from support import has_ffmpeg, make_edl, seconds  # first: it sets a scratch ZKS_HOME

from zks_engine import music_bed, music_dsp, pipeline, sfx

RATE = music_dsp.RATE
SHORT = {"duration": 17.3333, "sections": [{"at": 0, "kind": "cold", "energy": 0.4}, {"at": 6, "kind": "intro", "energy": 0.9}]}
# 60 s of edit: source 0-30 s and 32-62 s (the 2 s between is cut).
EDIT = make_edl([(0, 900), (960, 1860)])
MUSIC = {"bpm": 92, "sections": [{"at": 0, "kind": "cold", "energy": 0.3}, {"at": 8, "kind": "intro", "energy": 0.7},
                                 {"at": 31, "kind": "chapter", "energy": 0.6}, {"at": 50, "kind": "outro", "energy": 0.5}]}


def db(value):
    return 20 * np.log10(max(value, 1e-12))


def rms(samples):
    return float(np.sqrt(np.mean(samples**2)))


def band_share(audio, low, high, block=8192):
    """Fraction of spectral power between low and high Hz in the mono sum."""
    mono = audio.mean(axis=1)
    frames = mono[: len(mono) // block * block].reshape(-1, block) * np.hanning(block)
    power = (np.abs(np.fft.rfft(frames, axis=1)) ** 2).sum(axis=0)
    freqs = np.fft.rfftfreq(block, 1 / RATE)
    return float(power[(freqs >= low) & (freqs < high)].sum() / power.sum())


class RenderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.audio = music_bed.render_bed(SHORT)

    def test_exact_sample_count_finite_and_under_minus_1_dbfs(self):
        self.assertEqual(len(self.audio), round(17.3333 * RATE))
        self.assertEqual(len(music_bed.render_bed(SHORT, samples=RATE * 17)), RATE * 17)
        self.assertTrue(np.isfinite(self.audio).all())
        self.assertLessEqual(db(np.abs(self.audio).max()), -1.0)

    def test_deterministic_and_seeded(self):
        np.testing.assert_array_equal(music_bed.render_bed(SHORT), self.audio)
        self.assertFalse(np.array_equal(music_bed.render_bed({**SHORT, "seed": 9}), self.audio))

    def test_loudness_about_minus_18_lufs_and_a_clear_voice_band(self):
        self.assertAlmostEqual(music_dsp.integrated_lufs(self.audio), music_bed.TARGET_LUFS, delta=1.0)
        self.assertLess(band_share(self.audio, 1000, 4000), 0.15)

    def test_the_section_change_is_heard(self):
        at = 6 * RATE
        self.assertGreater(abs(db(rms(self.audio[at : at + 2 * RATE])) - db(rms(self.audio[at - 2 * RATE : at]))), 0.5)

    def test_fades_out_with_no_clicks(self):
        self.assertLess(db(rms(self.audio[-int(0.01 * RATE) :])), -60)
        self.assertLess(np.abs(np.diff(self.audio, axis=0)).max(), 0.25)

    def test_bad_sections_are_refused(self):
        bad = [[{"at": 1, "kind": "cold"}], [{"at": 0, "kind": "cold"}, {"at": 8, "kind": "intro"}, {"at": 4, "kind": "chapter"}],
               [{"at": 0, "kind": "bridge"}], [{"at": 0, "kind": "cold", "energy": 2}]]
        for sections in bad:
            with self.subTest(sections=sections), self.assertRaises(ValueError):
                music_bed.render_bed({"duration": 10, "sections": sections})

    def test_shorter_than_one_loudness_block_stays_finite(self):
        audio = music_bed.render_bed({"duration": 0.3, "sections": [{"at": 0, "kind": "cold"}]})
        self.assertEqual(len(audio), round(0.3 * RATE))
        self.assertTrue(np.isfinite(audio).all())


class SectionMapTests(unittest.TestCase):
    def test_source_seconds_map_onto_the_edit(self):
        sections = music_bed.edited_sections(MUSIC, EDIT)
        self.assertEqual([section["kind"] for section in sections], ["cold", "intro", "chapter", "outro"])
        # Source 31 s falls in the cut (30-32 s): it lands on the next kept frame, edited 900 frames.
        self.assertEqual([round(section["at"], 3) for section in sections], [0.0, 8.0, round(seconds(900), 3), round(50 - seconds(60), 3)])
        self.assertEqual(sections[2]["energy"], 0.6)

    def test_sections_a_cut_collapses_keep_the_later_one(self):
        music = {"sections": [{"at": 0, "kind": "cold"}, {"at": 30.5, "kind": "intro"}, {"at": 31.5, "kind": "chapter"}]}
        self.assertEqual([section["kind"] for section in music_bed.edited_sections(music, EDIT)], ["cold", "chapter"])

    def test_a_section_after_the_edit_drops(self):
        music = {"sections": [{"at": 0, "kind": "cold"}, {"at": 70, "kind": "outro"}]}
        self.assertEqual(len(music_bed.edited_sections(music, EDIT)), 1)


def studio_cuts(**extra):
    return {"schemaVersion": 1, "sourceAssetId": "00000000-0000-4000-8000-0000000a0002", "durationS": 62.06, "fps": {"num": 30000, "den": 1001},
            "removals": [], **extra}


class WorkDirCase(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.work = Path(folder.name)
        for sub in ("audio", "edl", "cuts"):
            (self.work / sub).mkdir()
        for module in (music_bed, sfx, pipeline):
            patcher = mock.patch.object(module, "WORK", self.work)
            patcher.start()
            self.addCleanup(patcher.stop)
        (self.work / "edl" / "t.json").write_text(json.dumps({**EDIT, "base": "t"}), encoding="utf-8")
        self.bed = self.work / "audio" / "t_bed.wav"

    def cuts(self, name="t", **extra):
        (self.work / "cuts" / f"{name}.json").write_text(json.dumps(studio_cuts(**extra)), encoding="utf-8")


class WriteTests(WorkDirCase):
    def test_no_music_means_no_bed_and_a_stale_one_goes(self):
        self.cuts()
        self.bed.write_bytes(b"old")
        with mock.patch("builtins.print"):
            self.assertIsNone(music_bed.main("t"))
        self.assertFalse(self.bed.exists())

    def test_a_reel_takes_its_bases_music(self):
        self.cuts(music={"sections": [{"at": 0, "kind": "cold"}]})
        (self.work / "cuts" / "tr.json").write_text(json.dumps({"base": "t", "reel": True, "duration": 62.06}), encoding="utf-8")
        self.assertEqual(music_bed.music_of("tr"), {"sections": [{"at": 0, "kind": "cold"}]})
        self.assertIsNone(music_bed.music_of("t2"))


@unittest.skipUnless(has_ffmpeg(), "needs ffmpeg")
class SixtySecondMixTests(WorkDirCase):
    """A bed for a 60 s fixture edit, mixed under a -14 LUFS voice with its SFX: the master's loudness gates still pass."""

    def speech(self, samples):
        """Speech-like noise: syllable bursts with pauses at -14 LUFS, peaks limited like the edit's loudnorm leaves them."""
        rng = np.random.default_rng(3)
        t = np.arange(samples) / RATE
        voiced = (np.sin(2 * np.pi * 1.3 * t) > -0.2) * np.abs(np.sin(2 * np.pi * 4 * t))
        mono = music_dsp.convolve(rng.standard_normal(samples), music_dsp.lowpass_fir(3000)) * voiced
        stereo = np.column_stack([mono, mono])
        for _ in range(3):
            stereo = music_dsp.limit(stereo * 10 ** ((-14 - music_dsp.integrated_lufs(stereo)) / 20), 10 ** (-1.5 / 20))
        return stereo

    def test_the_bed_is_the_edits_length_and_the_mix_passes_minus_14_lufs(self):
        self.cuts(music=MUSIC)
        samples = pipeline.frame_to_sample(EDIT["frames"], EDIT)
        sfx.write_wav(self.work / "audio" / "t_edit.wav", self.speech(samples))
        events = [{"time": 0.5, "sound": "riser"}, {"time": 4.0, "sound": "tick"}, {"time": 20.0, "sound": "boom"}]
        (self.work / "edl" / "t.sfx.json").write_text(json.dumps({"frames": EDIT["frames"], "events": events}), encoding="utf-8")
        with mock.patch("builtins.print"):
            self.assertEqual(music_bed.main("t"), self.bed)
            self.assertEqual(len(pipeline.read_wav(self.bed)), samples)
            sfx.main("t")
        lufs, true_peak = pipeline.loudness(self.work / "audio" / "t_mix.wav")
        self.assertLessEqual(abs(lufs - -14), 1.0)
        self.assertLessEqual(true_peak, -1.0)
        mix, voice = pipeline.read_wav(self.work / "audio" / "t_mix.wav"), pipeline.read_wav(self.work / "audio" / "t_edit.wav")
        self.assertGreater(rms(mix[: RATE] - voice[: RATE]), 1e-4, "the bed is under the voice")


if __name__ == "__main__":
    unittest.main()
