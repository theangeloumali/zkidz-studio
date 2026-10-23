# Created by The Angelo Umali.
import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from support import needs_renderer  # first: it sets a scratch ZKS_HOME


def run(case_class):
    result = unittest.TestResult()
    unittest.defaultTestLoader.loadTestsFromTestCase(case_class).run(result)
    return result


def make_case(ready):
    @needs_renderer(ready, "no renderer")
    class Case(unittest.TestCase):
        def test_draws(self):
            pass

    return Case


class NeedsRendererTests(unittest.TestCase):
    def test_a_ready_renderer_runs_the_tests(self):
        result = run(make_case(True))
        self.assertEqual((result.testsRun, result.skipped, result.errors, result.failures), (1, [], [], []))

    def test_a_missing_renderer_skips_by_default(self):
        with mock.patch.dict(os.environ, {"ZKS_REQUIRE_HF": ""}):
            result = run(make_case(False))
        self.assertEqual([reason for _, reason in result.skipped], ["no renderer"])

    def test_a_missing_renderer_fails_when_ci_requires_it(self):
        with mock.patch.dict(os.environ, {"ZKS_REQUIRE_HF": "1"}):
            result = run(make_case(False))
        self.assertEqual(result.skipped, [])
        self.assertEqual(len(result.errors) + len(result.failures), 1)
        self.assertIn("ZKS_REQUIRE_HF=1", str(result.errors + result.failures))

    def test_a_missing_renderer_fails_a_single_test_method_too(self):
        class Case(unittest.TestCase):
            @needs_renderer(False, "no renderer")
            def test_draws(self):
                pass

        with mock.patch.dict(os.environ, {"ZKS_REQUIRE_HF": "1"}):
            result = run(Case)
        self.assertEqual(len(result.failures), 1)


if __name__ == "__main__":
    unittest.main()


class HasFfmpegTests(unittest.TestCase):
    """CI hands the engine the pinned ffmpeg through ZKS_FFMPEG with none on PATH, so the guards must follow ZKS_FFMPEG."""

    def test_follows_zks_ffmpeg_with_nothing_on_path(self):
        from support import has_ffmpeg

        with tempfile.TemporaryDirectory() as tools:
            for name in ("ffmpeg", "ffprobe"):
                tool = Path(tools) / name
                tool.write_text("")
                tool.chmod(0o755)
            with mock.patch.dict(os.environ, {"ZKS_FFMPEG": str(Path(tools) / "ffmpeg"), "PATH": ""}):
                self.assertTrue(has_ffmpeg())

    def test_no_test_looks_ffmpeg_up_on_path_directly(self):
        offenders = [
            f"{path.name}:{number}"
            for path in sorted(Path(__file__).parent.rglob("*.py"))
            for number, line in enumerate(path.read_text().splitlines(), 1)
            if re.search(r"""which\(["']ff(mpeg|probe)["']\)""", line)
        ]
        self.assertEqual(offenders, [])
