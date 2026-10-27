# Created by The Angelo Umali.
# ZKS_HOME resolution: the engine's data dirs follow ZKS_HOME, never a hard-coded cache path.
import os
import unittest
from pathlib import Path
from unittest import mock

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import home


class HomeTests(unittest.TestCase):
    def test_zks_home_wins(self):
        with mock.patch.dict(os.environ, {"ZKS_HOME": "/srv/zks"}):
            self.assertEqual(home.zks_home(), Path("/srv/zks"))

    def test_linux_default_is_the_xdg_data_dir(self):
        with mock.patch.dict(os.environ, {"XDG_DATA_HOME": "/data"}, clear=True):
            self.assertEqual(home.zks_home(platform="linux"), Path("/data/zkidz-studio"))
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(home.zks_home(platform="linux"), Path.home() / ".local" / "share" / "zkidz-studio")

    def test_mac_and_windows_defaults(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(home.zks_home(platform="darwin"), Path.home() / "Library" / "Application Support" / "zkidz-studio")
        with mock.patch.dict(os.environ, {"LOCALAPPDATA": "C:/Users/someone/AppData/Local"}, clear=True):
            self.assertEqual(home.zks_home(platform="win32"), Path("C:/Users/someone/AppData/Local/zkidz-studio"))

    def test_data_dirs_live_under_zks_home_unless_overridden(self):
        with mock.patch.dict(os.environ, {"ZKS_HOME": "/srv/zks"}, clear=True):
            self.assertEqual(home.data_dir("models"), Path("/srv/zks/models"))
            self.assertEqual(home.data_dir("locks"), Path("/srv/zks/locks"))
        with mock.patch.dict(os.environ, {"ZKS_HOME": "/srv/zks", "ZKS_LOCKS": "/run/locks"}, clear=True):
            self.assertEqual(home.data_dir("locks"), Path("/run/locks"))


if __name__ == "__main__":
    unittest.main()
