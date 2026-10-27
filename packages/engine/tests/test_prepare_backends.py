# Created by The Angelo Umali.
# The review proxy encodes through the active backend; only NVIDIA keeps CUDA frames, and only when it can turn them.
import unittest
from pathlib import Path
from unittest import mock

from support import media_file  # first: it sets a scratch ZKS_HOME

from zks_engine import backends, prepare


def proxy_command(name, rotation_filter="", transpose_cuda=True):
    runs = []
    with (mock.patch.object(prepare.subprocess, "run", side_effect=lambda command, **_: runs.append(command)),
          mock.patch.object(prepare, "orientation_filter", side_effect=lambda source, cuda: rotation_filter if cuda else ""),
          mock.patch.object(prepare, "has_filter", return_value=transpose_cuda),
          mock.patch.object(prepare, "assert_upright"), mock.patch.object(Path, "replace")):
        prepare.build_proxy(media_file("a.mp4"), "v1", backends.get(name))
    return runs[0]


class ProxyBackendTests(unittest.TestCase):
    def test_nvidia_keeps_cuda_frames_and_its_proxy_encoder(self):
        command = proxy_command("nvidia")
        self.assertIn("-hwaccel_output_format", command)
        self.assertEqual(command[command.index("-c:v"):command.index("-g")], backends.get("nvidia").proxy)

    def test_a_quarter_turn_without_transpose_cuda_decodes_to_system_frames(self):
        command = proxy_command("nvidia", "transpose_cuda=dir=clock", transpose_cuda=False)
        self.assertNotIn("-hwaccel_output_format", command)
        self.assertNotIn("transpose", command[command.index("-vf") + 1])

    def test_vaapi_decodes_on_its_device_and_uploads_for_its_encoder(self):
        vaapi = backends.get("vaapi")
        command = proxy_command("vaapi")
        self.assertEqual(command[command.index("-vf") + 1], "scale=1080:1920:flags=lanczos,sidedata=mode=delete:type=DISPLAYMATRIX,format=nv12,hwupload")
        self.assertLess(command.index("-hwaccel"), command.index("-i"))
        self.assertEqual(command[command.index("-c:v"):command.index("-g")], vaapi.proxy)

    def test_cpu_uses_its_software_proxy_encoder(self):
        command = proxy_command("cpu")
        self.assertNotIn("-hwaccel", command)
        self.assertEqual(command[command.index("-c:v"):command.index("-g")], backends.get("cpu").proxy)


if __name__ == "__main__":
    unittest.main()
