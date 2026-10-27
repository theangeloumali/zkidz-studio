# Created by The Angelo Umali.
# capabilities.json (plan §7.2): the probe's backend and what the engine can render with it, read by get_capabilities.
import dataclasses
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from support import has_ffmpeg  # first: it sets a scratch ZKS_HOME

from zks_engine import backends, capabilities, cli

# getCapabilities.output in packages/shared/src/tools/media.ts is a strictObject: exactly these keys.
SCHEMA_KEYS = {"profile", "features", "transcribe"}
FEATURE_KEYS = {"uhd", "intro", "zoomExpr", "matte"}
ALL_READY = {"opencl": True, "hyperframes": True, "torch": True}


def summary(name, libplacebo=False, **ready):
    return capabilities.summarize(dataclasses.replace(backends.get(name), libplacebo=libplacebo), **{**ALL_READY, **ready})


class SummarizeTests(unittest.TestCase):
    def test_every_profile_reports_the_schema_keys_and_whisper_cpp(self):
        for name in backends.PROBE_ORDER:
            result = summary(name)
            self.assertEqual(set(result), SCHEMA_KEYS)
            self.assertEqual(set(result["features"]), FEATURE_KEYS)
            self.assertEqual(result["profile"], name)
            self.assertEqual(result["transcribe"], "whisper.cpp")

    def test_only_nvidia_renders_a_4k_master(self):
        self.assertEqual({name: summary(name, libplacebo=True)["features"]["uhd"] for name in backends.PROBE_ORDER},
                         {name: name == "nvidia" for name in backends.PROBE_ORDER})

    def test_zooms_need_the_nvidia_composite_with_opencl_and_libplacebo(self):
        self.assertTrue(summary("nvidia", libplacebo=True)["features"]["zoomExpr"])
        self.assertFalse(summary("nvidia", libplacebo=False)["features"]["zoomExpr"])
        self.assertFalse(summary("nvidia", libplacebo=True, opencl=False)["features"]["zoomExpr"])
        self.assertFalse(summary("cpu", libplacebo=True)["features"]["zoomExpr"])

    def test_the_matte_also_needs_torch(self):
        self.assertTrue(summary("nvidia", libplacebo=True)["features"]["matte"])
        self.assertFalse(summary("nvidia", libplacebo=True, torch=False)["features"]["matte"])
        self.assertFalse(summary("nvidia", libplacebo=False)["features"]["matte"])

    def test_the_intro_renders_on_any_backend_once_hyperframes_is_ready(self):
        self.assertTrue(summary("cpu")["features"]["intro"])
        self.assertFalse(summary("nvidia", libplacebo=True, hyperframes=False)["features"]["intro"])


class WriteTests(unittest.TestCase):
    def test_writes_the_object_into_zks_home_owner_only(self):
        with tempfile.TemporaryDirectory() as scratch:
            home = Path(scratch) / "home"
            with mock.patch.dict(os.environ, {"ZKS_HOME": str(home)}):
                path = capabilities.write(summary("cpu"))
            self.assertEqual(path, home / "capabilities.json")
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), summary("cpu"))
            self.assertEqual(list(home.glob("*.tmp")), [])
            if os.name == "posix":
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                self.assertEqual(stat.S_IMODE(home.stat().st_mode), 0o700)

    def test_a_rewrite_replaces_the_old_file(self):
        with tempfile.TemporaryDirectory() as scratch, mock.patch.dict(os.environ, {"ZKS_HOME": scratch}):
            capabilities.write(summary("cpu"))
            path = capabilities.write(summary("nvidia", libplacebo=True))
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["profile"], "nvidia")


class CommandTests(unittest.TestCase):
    def test_the_command_reports_the_file_the_object_and_every_attempt(self):
        attempts = [{"backend": name, "encoder": "x", "ok": name == "cpu"} for name in backends.PROBE_ORDER]
        with tempfile.TemporaryDirectory() as scratch, mock.patch.dict(os.environ, {"ZKS_HOME": scratch}), \
                mock.patch.object(backends, "probe_attempts", return_value=attempts), \
                mock.patch.object(capabilities, "machine_support", return_value=ALL_READY):
            payload = cli.capabilities_payload(cli.parser().parse_args(["capabilities", "--json"]))
            written = json.loads(Path(scratch, "capabilities.json").read_text(encoding="utf-8"))
        self.assertEqual(payload["capabilities"], written)
        self.assertEqual(written["profile"], "cpu")
        self.assertEqual(payload["attempts"], attempts)
        self.assertEqual(payload["path"], str(Path(scratch, "capabilities.json")))

    def test_a_pinned_backend_wins_over_the_probe(self):
        attempts = [{"backend": name, "encoder": "x", "ok": True} for name in backends.PROBE_ORDER]
        with tempfile.TemporaryDirectory() as scratch, mock.patch.dict(os.environ, {"ZKS_HOME": scratch, "ZKS_BACKEND": "cpu"}), \
                mock.patch.object(backends, "probe_attempts", return_value=attempts), \
                mock.patch.object(capabilities, "machine_support", return_value=ALL_READY):
            payload = cli.capabilities_payload(cli.parser().parse_args(["capabilities", "--json"]))
        self.assertEqual(payload["capabilities"]["profile"], "cpu")


@unittest.skipUnless(has_ffmpeg(), "needs ffmpeg")
class RealProbeTests(unittest.TestCase):
    def test_the_written_file_has_exactly_the_schema_keys(self):
        with tempfile.TemporaryDirectory() as scratch:
            result = subprocess.run([sys.executable, "-m", "zks_engine.cli", "capabilities", "--json"], capture_output=True, text=True,
                                    env={**os.environ, "ZKS_HOME": scratch}, timeout=600)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            written = json.loads(Path(scratch, "capabilities.json").read_text(encoding="utf-8"))
        self.assertEqual(set(written), SCHEMA_KEYS)
        self.assertEqual(set(written["features"]), FEATURE_KEYS)
        self.assertIn(written["profile"], backends.PROBE_ORDER)
        self.assertTrue(all(isinstance(value, bool) for value in written["features"].values()))
        self.assertEqual(json.loads(result.stdout)["capabilities"], written)


if __name__ == "__main__":
    unittest.main()
