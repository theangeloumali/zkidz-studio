# Created by The Angelo Umali.
# The doctor says which filters an NVIDIA render's zooms, reframes, focus and matte run on.
import dataclasses
import unittest
from unittest import mock

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import backends, doctor, render_final


class MotionFilterTests(unittest.TestCase):
    def check(self, name, libplacebo, opencl):
        backend = dataclasses.replace(backends.get(name), libplacebo=libplacebo)
        with mock.patch.object(doctor.backends, "active", return_value=backend), \
                mock.patch.object(render_final, "has_opencl", return_value=opencl):
            return doctor.check_gpu()[1]

    def test_opencl_and_libplacebo_are_the_fast_gpu_filters(self):
        self.assertIn("motion on fast GPU filters", self.check("nvidia", True, True))

    def test_without_either_motion_takes_the_cpu_filters(self):
        self.assertIn("motion on CPU filters", self.check("nvidia", False, True))
        self.assertIn("motion on CPU filters", self.check("nvidia", True, False))

    def test_other_backends_render_no_motion(self):
        self.assertNotIn("motion", self.check("vaapi", True, True))


if __name__ == "__main__":
    unittest.main()
