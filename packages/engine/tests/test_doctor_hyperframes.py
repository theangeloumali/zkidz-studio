# Created by The Angelo Umali.
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import support  # noqa: F401  first: it sets a scratch ZKS_HOME
from zks_engine import doctor


class CheckHyperframesTests(unittest.TestCase):
    def test_a_missing_install_points_at_the_workspace_install(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, "package.json").write_text(json.dumps({"dependencies": {"gsap": "3.15.0"}}), encoding="utf-8")
            with mock.patch.object(doctor, "HF_DIR", Path(folder)):
                ready, detail = doctor.check_hyperframes()
        self.assertFalse(ready)
        self.assertIn("pnpm install", detail)
        self.assertNotIn("npm ci", detail)


if __name__ == "__main__":
    unittest.main()
