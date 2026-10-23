# Created by The Angelo Umali.
# join_sources pieces: hwdownload cannot convert NVDEC surfaces, so each clip downloads in its own bit depth; every other
# backend (and a quarter-turned clip without transpose_cuda) decodes to system frames that autorotate turns.
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from support import media_file  # first: it sets a scratch ZKS_HOME

from zks_engine import backends, ffio, join_sources

NVIDIA, CPU = backends.get("nvidia"), backends.get("cpu")


def command_for(clip, backend=NVIDIA, transpose_cuda=True):
    with mock.patch.object(join_sources, "has_filter", return_value=transpose_cuda):
        return join_sources.piece_command(clip, 0, 30, Path("out.mp4"), backend)


def piece_filter(clip, backend=NVIDIA, transpose_cuda=True):
    command = command_for(clip, backend, transpose_cuda)
    return command[command.index("-vf") + 1]


def clip(name="a.mp4", **fields):
    return join_sources.Clip(media_file(name), 30, **{"hdr": False, "zoom": 1.0, "ten_bit": False, **fields})


class PieceCommandTests(unittest.TestCase):
    def test_an_8_bit_clip_downloads_nv12(self):
        self.assertIn("hwdownload,format=nv12,", piece_filter(clip()))

    def test_a_10_bit_clip_downloads_p010le(self):
        self.assertIn("hwdownload,format=p010le,", piece_filter(clip(hdr=True, ten_bit=True)))

    def test_a_portrait_phone_clip_turns_upright_on_the_gpu(self):
        # iPhone stores 3840x2160 with a -90 display matrix; NVDEC frames are never autorotated (#39).
        self.assertIn("transpose_cuda=dir=clock,hwdownload,format=p010le,", piece_filter(clip("a.mov", hdr=True, ten_bit=True, rotation=270)))

    def test_without_transpose_cuda_a_quarter_turn_decodes_to_system_frames(self):
        command = command_for(clip("a.mov", rotation=270), transpose_cuda=False)
        graph = command[command.index("-vf") + 1]
        self.assertNotIn("hwdownload", graph)
        self.assertNotIn("transpose", graph)
        self.assertIn(join_sources.SCALE, graph)
        self.assertNotIn("-hwaccel_output_format", command)

    def test_the_display_matrix_is_dropped_so_players_do_not_turn_it_again(self):
        self.assertIn("sidedata=mode=delete:type=DISPLAYMATRIX", piece_filter(clip("a.mov", rotation=270)))

    def test_an_unrotated_clip_is_not_turned(self):
        self.assertNotIn("transpose", piece_filter(clip(hdr=True, ten_bit=True)))

    def test_frames_restamp_onto_the_clips_own_rate(self):
        command = command_for(clip(fps=(25, 1)))
        self.assertIn("settb=1/25,setpts=N", command[command.index("-vf") + 1])
        self.assertEqual(command[command.index("-r") + 1], "25/1")


class BackendPieceTests(unittest.TestCase):
    def test_the_cpu_backend_scales_and_tone_maps_on_the_cpu(self):
        command = command_for(clip(hdr=True, ten_bit=True, zoom=1.25), CPU)
        self.assertEqual(command[command.index("-vf") + 1],
                         "select='between(n,0,29)',crop=iw/1.25:ih/1.25:(iw-iw/1.25)/2:0,"
                         f"{join_sources.CPU_TONEMAP},{join_sources.CPU_SCALE},settb=1001/30000,setpts=N,sidedata=mode=delete:type=DISPLAYMATRIX")
        self.assertNotIn("vulkan", command)
        self.assertEqual(command[command.index("-c:v"):command.index("-an")], CPU.mezzanine)

    def test_vaapi_uploads_the_finished_frame_to_its_render_node(self):
        vaapi = backends.get("vaapi")
        command = command_for(clip(), vaapi)
        self.assertTrue(command[command.index("-vf") + 1].endswith(",format=nv12,hwupload"))
        self.assertLess(command.index("vaapi=va:/dev/dri/renderD128"), command.index("-i"))
        self.assertEqual(command[command.index("-c:v"):command.index("-an")], vaapi.mezzanine)

    def test_pieces_split_by_the_backends_jobs(self):
        long = join_sources.Clip(media_file("a.mp4"), 9000, False, 1.0, False)
        self.assertEqual(len(join_sources.pieces([long], 2)), 2)
        self.assertEqual(len(join_sources.pieces([long], 4)), 4)


class RateTests(unittest.TestCase):
    def probe(self, rate):
        stream = {"streams": [{"nb_read_packets": "50", "r_frame_rate": rate, "pix_fmt": "yuv420p"}]}
        with (mock.patch.object(join_sources.subprocess, "run", return_value=mock.Mock(stdout=__import__("json").dumps(stream))),
              mock.patch.object(join_sources, "probe_video", return_value={})):
            return join_sources.probe(str(media_file("a.mp4")))

    def test_any_constant_rate_is_read(self):
        for rate, fps in (("24000/1001", (24000, 1001)), ("25/1", (25, 1)), ("30000/1001", (30000, 1001)), ("30/1", (30, 1)),
                          ("60000/1001", (60000, 1001))):
            self.assertEqual(self.probe(rate).fps, fps, rate)

    def test_clips_at_different_rates_are_refused(self):
        with self.assertRaisesRegex(SystemExit, "25/1"):
            join_sources.common_rate([clip(), clip(fps=(25, 1))])
        self.assertEqual(join_sources.common_rate([clip(fps=(25, 1))]), (25, 1))


@unittest.skipUnless(shutil.which(ffio.ffmpeg_bin()), "needs ffmpeg")
class FrameExactTests(unittest.TestCase):
    """Real decodes on the cpu backend: select by decode index, then restamp, keeps exact counts at every rate."""

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)

    def source(self, name, rate, rotation=None):
        path = self.root / name
        subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-f", "lavfi", "-i", f"testsrc2=size=320x180:rate={rate}:duration=1.5", "-c:v", "libx264",
                        "-pix_fmt", "yuv420p", str(path)], check=True)
        if rotation is None:
            return path
        turned = self.root / f"turned-{name}"
        subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-display_rotation", str(rotation), "-i", str(path), "-c", "copy", str(turned)], check=True)
        return turned

    def frames(self, path, rate):
        piece = join_sources.Clip(path, 0, False, 1.0, False, fps=tuple(int(part) for part in rate.split("/")))
        command = join_sources.piece_command(piece, 5, 20, Path("unused.mp4"), CPU)
        out = command.index("-c:v")
        decode = subprocess.run([*command[:out], "-f", "framecrc", "-"], capture_output=True, text=True, check=True)
        return [line.split(",") for line in decode.stdout.splitlines() if line and not line.startswith("#")]

    def test_every_rate_keeps_exact_frame_counts_and_a_gapless_grid(self):
        for rate in ("24000/1001", "25/1", "30000/1001", "30/1", "60000/1001"):
            rows = self.frames(self.source(f"{rate.replace('/', '-')}.mp4", rate), rate)
            self.assertEqual(len(rows), 20, rate)
            self.assertEqual([int(row[2]) for row in rows], list(range(20)), rate)  # pts in the output's 1/rate grid

    def test_a_rotated_source_turns_upright_and_keeps_its_count(self):
        turned = self.source("r.mp4", "30000/1001", rotation=90)
        rows = self.frames(turned, "30000/1001")
        self.assertEqual(len(rows), 20)
        self.assertEqual(rows[0][-1], self.reference(turned, "transpose=cclock,"))  # frame 5, turned as the matrix says
        self.assertNotEqual(rows[0][-1], self.reference(turned, ""))

    def reference(self, path, turn):
        graph = f"select='eq(n,5)',{turn}{join_sources.CPU_SCALE}"
        decode = subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-noautorotate", "-i", str(path), "-vf", graph, "-frames:v", "1", "-f", "framecrc", "-"],
                                capture_output=True, text=True, check=True)
        return next(line for line in decode.stdout.splitlines() if line and not line.startswith("#")).split(",")[-1]


if __name__ == "__main__":
    unittest.main()
