# Created by The Angelo Umali.
# zks-engine check-window / energy-profile: what the agent reads before it moves a cut.
import contextlib
import io
import json
import shutil
import tempfile
import unittest
import wave
from pathlib import Path
from unittest import mock

import numpy as np

from support import ENGINE  # first: it sets a scratch ZKS_HOME

from zks_engine import captions, check_windows, cli, inspect_commands, pipeline
from zks_engine.transcribe import whispercpp

JFK_WAV = ENGINE / "tests" / "fixture" / "whisper" / "jfk-3s.wav"
RATE = 16000


def call_cli(*args):
    """cli.main in-process: (exit code, parsed stdout)."""
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = cli.main(list(args))
    return code, json.loads(out.getvalue())


def help_text(command):
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.suppress(SystemExit):
        cli.main([command, "--help"])
    return out.getvalue()


def write_wav(path, quiet_loud_quiet):
    """A mono 16 kHz WAV: silence, a loud tone, silence, for the given lengths in seconds."""
    quiet_a, loud, quiet_b = (int(seconds * RATE) for seconds in quiet_loud_quiet)
    tone = 0.5 * np.sin(2 * np.pi * 440 * np.arange(loud) / RATE)
    samples = np.concatenate([np.zeros(quiet_a), tone, np.zeros(quiet_b)])
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes((samples * 32767).astype(np.int16).tobytes())


class ScratchWork(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.work = Path(folder.name) / "work"
        for sub in ("audio", "cuts", "edl", "transcripts", "cues"):
            (self.work / sub).mkdir(parents=True)
        for module in (cli, pipeline, captions, check_windows, inspect_commands):
            self.patch(module, "WORK", self.work)

    def patch(self, target, name, *value, **options):
        started = mock.patch.object(target, name, *value, **options)
        self.addCleanup(started.stop)
        return started.start()

    def assert_refused(self, *args, mentions):
        code, payload = call_cli(*args)
        self.assertEqual(code, cli.EXIT_SPEC_INVALID, payload)
        self.assertEqual(payload["error"]["code"], "spec_invalid")
        self.assertIn(mentions, payload["error"]["message"])


class HelpTests(unittest.TestCase):
    def test_every_new_command_lists_json_in_its_help(self):
        for command in ("check-window", "energy-profile", "caption-phrases", "render-preview"):
            self.assertIn("--json", help_text(command), command)


class CheckWindowTests(ScratchWork):
    def setUp(self):
        super().setUp()
        shutil.copy(JFK_WAV, self.work / "audio" / "v1.wav")
        self.languages = []

        def fake_whisper(window_wav, language, model, threads):
            self.languages.append(language)
            return [{"start": 520, "end": 900, "text": " fellow "}]

        self.patch(whispercpp, "transcribe_file", side_effect=fake_whisper)
        self.patch(whispercpp, "model_path", return_value=Path("m.bin"))

    def test_each_range_comes_back_as_trimmed_words_in_source_seconds(self):
        code, payload = call_cli("check-window", "--json", "--video", "v1", "--range", "0.7-1.2", "--range", "2-2.5", "--language", "tl")
        self.assertEqual(code, 0, payload)
        self.assertEqual(payload, {"windows": [
            {"at": 0.7, "end": 1.2, "words": [{"at": 0.72, "end": 1.1, "text": "fellow"}]},
            {"at": 2.0, "end": 2.5, "words": [{"at": 2.02, "end": 2.4, "text": "fellow"}]},
        ]})
        self.assertEqual(self.languages, ["tl", "tl"])

    # QC's second opinion hears with the transcript's model; check_window must hear the same window the same way.
    def test_hears_with_the_named_model(self):
        code, _payload = call_cli("check-window", "--json", "--video", "v1", "--range", "0.7-1.2", "--model", "turbo")
        self.assertEqual(code, 0)
        whispercpp.model_path.assert_called_with("turbo")

    def test_two_windows_of_the_same_span_get_their_own_files(self):
        seen = []
        self.patch(whispercpp, "write_window", side_effect=lambda wav, start, end, out, **_: seen.append(out) or out.write_bytes(b""))
        code, _payload = call_cli("check-window", "--json", "--video", "v1", "--range", "0.7-1.2", "--range", "0.7-1.2")
        self.assertEqual(code, 0)
        self.assertEqual(len(set(seen)), 2)

    def test_language_defaults_to_auto(self):
        code, _payload = call_cli("check-window", "--json", "--video", "v1", "--range", "0.7-1.2")
        self.assertEqual(code, 0)
        self.assertEqual(self.languages, ["auto"])

    def test_refuses_bad_ranges_before_running_whisper(self):
        too_many = [arg for index in range(9) for arg in ("--range", f"{index}-{index + 0.5}")]
        self.assert_refused("check-window", "--json", "--video", "v1", *too_many, mentions="8")
        self.assert_refused("check-window", "--json", "--video", "v1", "--range", "2-2", mentions="end")
        self.assert_refused("check-window", "--json", "--video", "v1", "--range", "1-11.5", mentions="10")
        self.assert_refused("check-window", "--json", "--video", "v1", "--range", "one-two", mentions="range")
        self.assertEqual(self.languages, [])

    def test_refuses_without_the_ingested_audio(self):
        self.assert_refused("check-window", "--json", "--video", "v2", "--range", "0.7-1.2", mentions="ingest")


class EnergyProfileTests(ScratchWork):
    def setUp(self):
        super().setUp()
        write_wav(self.work / "audio" / "v1.wav", (1.0, 1.0, 0.5))

    def profile(self):
        return call_cli("energy-profile", "--json", "--video", "v1", "--from", "0.5", "--to", "2.5")

    def test_level_in_10_ms_steps_and_the_quiet_runs_in_source_seconds(self):
        code, payload = self.profile()
        self.assertEqual(code, 0, payload)
        self.assertEqual(payload["stepMs"], 10)
        self.assertEqual(len(payload["db"]), 200)
        self.assertEqual(payload["db"][0], -120.0)
        self.assertGreater(payload["db"][100], -10)
        self.assertEqual(payload["quietRuns"], [{"at": 0.5, "end": 1.0}, {"at": 2.0, "end": 2.5}])

    def test_the_cut_specs_trim_pauses_sets_threshold_and_minimum(self):
        cut_spec = self.work / "cuts" / "v1.json"
        cut_spec.write_text(json.dumps({"trimPauses": {"thresholdDb": -35, "minS": 0.6}}), encoding="utf-8")
        self.assertEqual(self.profile()[1]["quietRuns"], [])  # both runs last 0.5 s
        cut_spec.write_text(json.dumps({"trimPauses": {"thresholdDb": -200, "minS": 0.1}}), encoding="utf-8")
        self.assertEqual(self.profile()[1]["quietRuns"], [])  # silence at -120 dB is above -200

    def test_refuses_an_empty_or_long_window_and_missing_audio(self):
        self.assert_refused("energy-profile", "--json", "--video", "v1", "--from", "2", "--to", "2", mentions="--to")
        self.assert_refused("energy-profile", "--json", "--video", "v1", "--from", "0", "--to", "30.5", mentions="30")
        self.assert_refused("energy-profile", "--json", "--video", "v2", "--from", "0", "--to", "1", mentions="ingest")


if __name__ == "__main__":
    unittest.main()
