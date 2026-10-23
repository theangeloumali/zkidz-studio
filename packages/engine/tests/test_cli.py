# Created by The Angelo Umali.
# zks-engine <cmd> --json: the server's contract with the engine is JSON on stdout and the exit code.
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import __version__, cli


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

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "needs ffmpeg and ffprobe")
    def test_probe_prints_metadata(self):
        with tempfile.TemporaryDirectory() as scratch:
            clip = Path(scratch) / "clip.mkv"
            subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=64x36:rate=25:duration=0.4", "-c:v", "ffv1",
                            str(clip)], check=True)
            result = run_cli("probe", "--json", str(clip))
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["fps"], {"num": 25, "den": 1})
        self.assertIsNone(payload["audio"])


if __name__ == "__main__":
    unittest.main()
