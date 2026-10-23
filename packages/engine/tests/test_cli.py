# Created by The Angelo Umali.
# zks-engine <cmd> --json: the server's contract with the engine is JSON on stdout and the exit code.
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

from support import has_ffmpeg  # first: it sets a scratch ZKS_HOME

from zks_engine import __version__, cli, ffio


def run_cli(*args, env=None):
    return subprocess.run([sys.executable, "-m", "zks_engine.cli", *args], capture_output=True, text=True, env=env)


class CliTests(unittest.TestCase):
    def test_version_prints_json(self):
        result = run_cli("version", "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["name"], "zks-engine")
        self.assertEqual(payload["version"], __version__)
        self.assertRegex(payload["python"], r"^3\.\d+\.\d+")

    def test_json_is_required(self):
        self.assertNotEqual(run_cli("version").returncode, 0)

    def test_a_renamed_playlist_is_rejected_as_json(self):
        with tempfile.TemporaryDirectory() as scratch:
            fake = Path(scratch) / "holiday.mp4"
            fake.write_text("#EXTM3U\n#EXTINF:1,\nhttps://example.com/a.ts\n", encoding="utf-8")
            result = run_cli("probe", "--json", str(fake))
        self.assertEqual(result.returncode, cli.EXIT_REJECTED)
        error = json.loads(result.stdout)["error"]
        self.assertEqual(error["code"], "media_rejected")
        self.assertIn("playlist", error["message"])

    def test_a_missing_pinned_ffprobe_is_a_json_error(self):
        with tempfile.TemporaryDirectory() as scratch:
            clip = Path(scratch) / "clip.mp4"
            clip.write_bytes(b"\x00\x00\x00\x18ftypmp42")
            missing = str(Path(scratch) / "tools" / "ffprobe")
            result = run_cli("probe", "--json", str(clip), env={**os.environ, "ZKS_FFPROBE": missing})
        self.assertEqual(result.returncode, cli.EXIT_TOOL_MISSING)
        error = json.loads(result.stdout)["error"]
        self.assertEqual(error["code"], "tool_missing")
        self.assertIn(missing, error["message"])

    def test_an_unexpected_error_is_a_json_error_without_a_traceback(self):
        def explode(_args):
            raise KeyError("missing_field")

        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.object(cli, "version_payload", explode), redirect_stdout(stdout), redirect_stderr(stderr):
            code = cli.main(["version", "--json"])
        self.assertEqual(code, cli.EXIT_ENGINE_ERROR)
        self.assertEqual(json.loads(stdout.getvalue()), {"error": {"code": "engine_error", "message": "KeyError: 'missing_field'"}})
        self.assertNotIn("Traceback", stderr.getvalue())

    @unittest.skipUnless(has_ffmpeg(), "needs ffmpeg and ffprobe")
    def test_probe_prints_metadata(self):
        with tempfile.TemporaryDirectory() as scratch:
            clip = Path(scratch) / "clip.mkv"
            subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=64x36:rate=25:duration=0.4", "-c:v", "ffv1",
                            str(clip)], check=True)
            result = run_cli("probe", "--json", str(clip))
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["fps"], {"num": 25, "den": 1})
        self.assertIsNone(payload["audio"])


WORDS = [{"start": 1000, "end": 1300, "text": " So"}, {"start": 1300, "end": 1700, "text": " here's"}, {"start": 1700, "end": 2000, "text": " what"}]


def keyword(at, text="Here's what"):
    return {"kind": "keyword", "at": at, "end": at + 1.5, "tone": "chip", "text": text, "anchor": {"phrase": "here's what", "wordIndex": 1}}


class CueCommandTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.folder = Path(scratch.name)
        self.words = self.folder / "words.jsonl"
        self.words.write_text("".join(json.dumps(word) + "\n" for word in WORDS), encoding="utf-8")

    def cue_file(self, name, cue):
        path = self.folder / name
        path.write_text(json.dumps(cue), encoding="utf-8")
        return str(path)

    def test_cue_kinds_filters_by_tier_and_purpose(self):
        result = run_cli("cue-kinds", "--json", "--theme", "zkidz", "--tier", "core", "--purpose", "spoken phrase")
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["theme"], "zkidz")
        self.assertEqual([entry["kind"] for entry in payload["kinds"]], ["keyword"])

    def test_cue_kinds_rejects_an_unknown_tier_as_json(self):
        result = run_cli("cue-kinds", "--json", "--theme", "zkidz", "--tier", "loud")
        self.assertEqual(result.returncode, cli.EXIT_THEME_INVALID)
        self.assertEqual(json.loads(result.stdout)["error"]["code"], "theme_invalid")

    def test_validate_cue_returns_the_cue_on_its_word(self):
        result = run_cli("validate-cue", "--json", "--theme", "zkidz", "--words", str(self.words), "--cue", self.cue_file("cue.json", keyword(1.3)))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["cue"]["at"], 1.3)

    def test_validate_cue_reads_the_cue_from_stdin(self):
        result = subprocess.run([sys.executable, "-m", "zks_engine.cli", "validate-cue", "--json", "--theme", "zkidz", "--words", str(self.words),
                                 "--cue", "-"], input=json.dumps(keyword(1.3)), capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_a_cue_far_from_its_anchor_is_spec_invalid(self):
        result = run_cli("validate-cue", "--json", "--theme", "zkidz", "--words", str(self.words), "--cue", self.cue_file("late.json", keyword(4.0)))
        self.assertEqual(result.returncode, cli.EXIT_SPEC_INVALID)
        error = json.loads(result.stdout)["error"]
        self.assertEqual(error["code"], "spec_invalid")
        self.assertIn("after its anchor word", error["message"])

    def test_the_theme_width_table_applies(self):
        long_chip = keyword(1.3, text="x" * 40)
        result = run_cli("validate-cue", "--json", "--theme", "zkidz", "--words", str(self.words), "--cue", self.cue_file("wide.json", long_chip))
        self.assertEqual(result.returncode, cli.EXIT_SPEC_INVALID)
        self.assertIn("chars", json.loads(result.stdout)["error"]["message"])

    def test_stored_merges_the_patch_before_validating(self):
        stored = self.cue_file("stored.json", keyword(1.3))
        patch = self.cue_file("patch.json", {"at": 1.4, "end": 2.9})
        result = run_cli("validate-cue", "--json", "--theme", "zkidz", "--words", str(self.words), "--cue", patch, "--stored", stored)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["cue"]["text"], "Here's what")


if __name__ == "__main__":
    unittest.main()
