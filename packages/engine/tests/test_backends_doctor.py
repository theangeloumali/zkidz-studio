# Created by The Angelo Umali.
# The doctor names the render backend the probe picked, and says when that profile has no hardware proof yet.
import unittest
from unittest import mock

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import backends, doctor


class GpuCheckTests(unittest.TestCase):
    def check(self, name):
        with mock.patch.object(doctor.backends, "active", return_value=backends.get(name)):
            return doctor.check_gpu()

    def test_nvidia_names_its_encoder_and_jobs(self):
        ok, detail = self.check("nvidia")
        self.assertTrue(ok)
        self.assertIn("nvidia (hevc_nvenc)", detail)
        self.assertNotIn("untested", detail)

    def test_a_profile_without_hardware_proof_says_so(self):
        self.assertIn("untested on hardware", self.check("vaapi")[1])

    def test_cpu_is_a_pass_with_the_slower_path_named(self):
        ok, detail = self.check("cpu")
        self.assertTrue(ok)
        self.assertIn("cpu", detail)


if __name__ == "__main__":
    unittest.main()
