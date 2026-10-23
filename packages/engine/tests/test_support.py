# Created by The Angelo Umali.
import os
import unittest
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
