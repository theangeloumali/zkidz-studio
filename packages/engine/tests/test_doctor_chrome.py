# Created by The Angelo Umali.
# The Chrome check names the browser the overlay renderer will launch: ZKS_CHROME, else HyperFrames' own cache.
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import support  # noqa: F401  first: it sets a scratch ZKS_HOME
from zks_engine import doctor


def shell_in(cache_root):
    binary = Path(cache_root, "chrome-headless-shell", "linux-155.0.8059.39", "chrome-headless-shell-linux64", "chrome-headless-shell")
    binary.parent.mkdir(parents=True)
    binary.write_text("")
    return binary


class CheckChromeTests(unittest.TestCase):
    def test_a_zks_chrome_that_exists_is_the_one_reported(self):
        with tempfile.TemporaryDirectory() as folder:
            chrome = Path(folder, "chrome-headless-shell")
            chrome.write_text("")
            with mock.patch.dict(os.environ, {"ZKS_CHROME": str(chrome)}):
                self.assertEqual(doctor.check_chrome(), (True, f"Chrome at {chrome}"))

    def test_a_zks_chrome_that_does_not_exist_fails_with_the_setup_hint(self):
        with mock.patch.dict(os.environ, {"ZKS_CHROME": "/nonexistent/chrome"}):
            ready, detail = doctor.check_chrome()
        self.assertFalse(ready)
        self.assertIn("/nonexistent/chrome", detail)
        self.assertIn("pnpm zks setup", detail)

    def test_without_zks_chrome_it_reports_the_hyperframes_cache_and_ignores_a_system_chrome(self):
        with tempfile.TemporaryDirectory() as home:
            binary = shell_in(Path(home, ".cache", "hyperframes", "chrome"))
            env = {key: value for key, value in os.environ.items() if key != "ZKS_CHROME"}
            with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(Path, "home", return_value=Path(home)), \
                    mock.patch("shutil.which", return_value="/usr/bin/google-chrome"):
                self.assertEqual(doctor.check_chrome(), (True, f"Chrome at {binary}"))

    def test_without_any_renderer_chrome_it_fails_even_with_a_system_chrome(self):
        with tempfile.TemporaryDirectory() as home:
            env = {key: value for key, value in os.environ.items() if key != "ZKS_CHROME"}
            with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(Path, "home", return_value=Path(home)), \
                    mock.patch("shutil.which", return_value="/usr/bin/google-chrome"):
                ready, detail = doctor.check_chrome()
        self.assertFalse(ready)
        self.assertIn("pnpm zks setup", detail)


if __name__ == "__main__":
    unittest.main()
