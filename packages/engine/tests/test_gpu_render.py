# Created by The Angelo Umali.
# Unit tests for the CUDA render path: every heavy stage stays on the GPU, and the punch-in and blur land where the CPU path puts them.
import shutil
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from support import make_edl, seconds  # first: it sets a scratch ZKS_HOME

from zks_engine import blur
from zks_engine import prepare
from zks_engine import render_final
from zks_engine.pipeline import has_cuda

GPU_COMPOSITE = bool(shutil.which("ffmpeg") and has_cuda() and render_final.has_opencl())
GPU_SKIP = "needs ffmpeg with CUDA and the NVIDIA OpenCL platform (the GPU composite)"


def run_graph(graph, encoder, devices=()):
    """Runs a gpu_graph on a 4-second synthetic 4K clip and a transparent 1080p overlay, fed as CUDA frames."""
    graph = graph.replace("[0:v]", "[0:v]format=yuv420p,hwupload_cuda,", 1)
    return subprocess.run(["ffmpeg", "-v", "error", *devices, "-f", "lavfi", "-i", "testsrc2=size=2160x3840:rate=30000/1001:duration=4",
                           "-f", "lavfi", "-i", "color=black@0:size=1080x1920:rate=30000/1001:duration=4,format=rgba",
                           "-filter_complex", graph, "-map", "[v]", *encoder, "-f", "null", "-"], capture_output=True, text=True)


def edge_row(graph):
    """Runs a gpu_graph on one full-range 2160x3840 frame, black left and peak white right; returns the output's middle luma row."""
    width, height = render_final.UHD
    frame = (bytes(width // 2 + 1) + b"\xff" * (width // 2 - 1)) * height + b"\x80" * (width * height // 2)
    result = subprocess.run(["ffmpeg", "-v", "error", *render_final.OPENCL_DEVICE, "-f", "rawvideo", "-pix_fmt", "nv12", "-color_range", "pc",
                             "-s", f"{width}x{height}", "-i", "-", "-f", "lavfi", "-i", "color=black@0:size=1080x1920,format=rgba",
                             "-filter_complex", graph.replace("[0:v]", "[0:v]hwupload_cuda,", 1), "-map", "[v]", "-frames:v", "1",
                             "-f", "rawvideo", "-"], input=frame, capture_output=True, check=True)
    out_width, out_height = render_final.OUTPUT
    start = out_width * (out_height // 2)
    return result.stdout[start : start + out_width]


class GpuGraphTests(unittest.TestCase):
    timeline = make_edl([(0, 30), (40, 70), (90, 120)], [1.0, 1.08, 1.0])

    def test_punch_window_matches_the_cpu_crop(self):
        # CPU: crop 2000x3556 at (80, 110) of 2160x3840, then scale 0.54. GPU: scale to 1166x2074, window at (43, 59).
        self.assertEqual(render_final.punch_frame(), (1166, 2074, 43, 59))

    def test_decode_scale_and_punch_in_stay_on_cuda_and_the_composite_on_opencl(self):
        graph = render_final.gpu_graph(self.timeline, "transpose_cuda=dir=clock")
        # QC r7: TV range once, before every lanczos scale (see pipeline.CUDA_TV_RANGE).
        self.assertIn(f"transpose_cuda=dir=clock,{render_final.CUDA_TV_RANGE},split[wide_src][big_src]", graph)
        self.assertEqual(graph.count("colorspace_cuda"), 1)
        self.assertIn("scale_cuda=1080:1920:interp_algo=lanczos", graph)
        self.assertIn("scale_cuda=1166:2074:interp_algo=lanczos", graph)
        self.assertIn("[wide][big]overlay_cuda=x=-43:y=-59:enable='between(n,30,59)'[framed]", graph)
        self.assertIn(f"[framed]hwdownload,format=yuv420p,{render_final.DROP_ROTATION},{render_final.GRADE},hwupload[graded]", graph)
        self.assertTrue(graph.endswith(f"[graded][ovl]overlay_opencl,hwdownload,format=yuv420p,{render_final.BT709_TV}[v]"))
        self.assertNotIn("flags=lanczos", graph)  # no CPU resample of the 4K frame

    def test_proxy_turns_tv_range_before_its_lanczos_scale(self):
        self.assertEqual(prepare.proxy_filter("transpose_cuda=dir=clock", "", True),
                         f"transpose_cuda=dir=clock,{render_final.CUDA_TV_RANGE},scale_cuda=1080:1920:interp_algo=lanczos")

    def test_no_punch_keeps_the_wide_frame(self):
        graph = render_final.gpu_graph(make_edl([(0, 30)]), "")
        self.assertIn("overlay_cuda=x=-43:y=-59:enable='0'", graph)

    def test_no_cuda_upload_races_an_overlay(self):
        # QC r5: each hwupload_cuda made its own CUDA context, unordered against overlay_cuda, so random frames composited
        # half-uploaded (baseline scan: 0, 5 and 3 corrupt frames in 3 runs of 972). OpenCL uploads and filters complete in order.
        regions = blur.blur_regions({"blur": [[seconds(5), seconds(100), 100, 100, 200, 200, "a"]]}, self.timeline, render_final.OUTPUT)
        graph = render_final.gpu_graph(self.timeline, "", regions)
        self.assertNotIn("hwupload_cuda", graph)
        self.assertEqual(graph.count("hwupload,") + graph.count("hwupload["), 3)  # graded base, animation overlay, blur veil
        self.assertIn("[graded][veil]overlay_opencl[blurred];[blurred][ovl]overlay_opencl,", graph)
        self.assertEqual(graph.count("overlay_cuda"), 1)  # only the punch-in, whose inputs share the decoder's context

    def test_blur_box_follows_the_punch_in(self):
        regions = blur.blur_regions({"blur": [[seconds(20), seconds(50), 100, 200, 300, 400, "a"]]}, self.timeline, render_final.OUTPUT)
        placed = blur.output_regions(regions, [(30, 60)], render_final.punch_frame())
        plain, zoomed = placed
        self.assertEqual(plain, (100, 200, 300, 400, [(20, 30)]))
        # Source frames 40-50 play as edited 30-40. x 100 * 1166/1080 - 43 = 64.96 -> 64; y 200 * 2074/1920 - 59 = 157.04 -> 158.
        self.assertEqual(zoomed, (64, 158, 324, 432, [(30, 40)]))

    def test_nvenc_whenever_cuda_exists(self):
        self.assertEqual(render_final.video_encoder(True, False)[:2], ["-c:v", "h264_nvenc"])
        self.assertIn("p7", render_final.video_encoder(True, False))
        self.assertIn("p4", render_final.video_encoder(True, True))
        self.assertNotIn("libx264", render_final.video_encoder(True, False))

    def test_4k_punch_window_matches_the_1080_framing(self):
        self.assertEqual(render_final.punch_frame(*render_final.UHD), (2332, 4148, 86, 119))

    def test_4k_graph_keeps_detail_and_upscales_the_animations_on_the_gpu(self):
        graph = render_final.gpu_graph(self.timeline, "", (), render_final.UHD, render_final.CRISP)
        self.assertIn("scale_cuda=2160:3840:interp_algo=lanczos", graph)
        self.assertIn("overlay_cuda=x=-86:y=-119", graph)
        self.assertIn(f"{render_final.GRADE},hwupload,{render_final.CRISP}[graded]", graph)
        self.assertIn("libplacebo=w=2160:h=3840", graph)
        self.assertIn(render_final.DROP_ROTATION, graph)  # PNG and MP4 muxers would otherwise re-rotate the frames

    def test_blur_scales_to_the_4k_grid(self):
        regions = blur.blur_regions({"blur": [[seconds(20), seconds(50), 100, 200, 300, 400, "a"]]}, self.timeline, render_final.UHD)
        plain, zoomed = blur.output_regions(regions, [(30, 60)], render_final.punch_frame(*render_final.UHD), render_final.UHD)
        self.assertEqual(plain[:4], (200, 400, 600, 800))
        # y 400 * 4148/3840 - 119 = 313.08 -> 314; bottom 1200 * 4148/3840 - 119 = 1177.25 -> 1178.
        self.assertEqual(zoomed[:4], (130, 314, 648, 864))
        graph = blur.gpu_blur_graph([plain], "soften", render_final.GRADE, render_final.UHD)
        self.assertTrue(graph.startswith("[soften]scale_cuda=270:480"))
        self.assertIn("scale=2160:3840:flags=bilinear", graph)
        self.assertTrue(graph.endswith("hwupload[veil];"))

    @unittest.skipUnless(GPU_COMPOSITE, GPU_SKIP)
    def test_ffmpeg_runs_the_4k_graph(self):
        graph = render_final.gpu_graph(self.timeline, "", (), render_final.UHD, render_final.CRISP)
        result = run_graph(graph, render_final.UHD_ENCODER, render_final.OPENCL_DEVICE)
        self.assertEqual(result.returncode, 0, result.stderr[-2000:])

    @unittest.skipUnless(GPU_COMPOSITE, GPU_SKIP)
    def test_ffmpeg_runs_the_gpu_graph(self):
        regions = blur.blur_regions({"blur": [[0, seconds(100), 0, 0, 500, 500, "a"]]}, self.timeline, render_final.OUTPUT)
        result = run_graph(render_final.gpu_graph(self.timeline, "", regions), render_final.video_encoder(True, True), render_final.OPENCL_DEVICE)
        self.assertEqual(result.returncode, 0, result.stderr[-2000:])

    @unittest.skipUnless(GPU_COMPOSITE, GPU_SKIP)
    def test_a_peak_white_edge_keeps_its_white_side(self):
        # Before the fix the pixel right of the edge wrapped to near black (a 0|255 edge scaled 2x down read 127, 19, 250).
        row = edge_row(render_final.gpu_graph(make_edl([(0, 1)]), ""))
        middle = render_final.OUTPUT[0] // 2
        window = list(row[middle - 3 : middle + 4])
        self.assertGreaterEqual(min(row[middle + 1 :]), 150, window)
        self.assertLessEqual(max(row[: middle - 1]), 100, window)


RGBA, RGB = 6, 2  # PNG colour types


def write_png_header(path, width, height, colour=RGBA):
    """Just the signature and IHDR chunk (8-bit): all check_overlay_frames reads."""
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", width, height) + bytes([8, colour, 0, 0, 0]))


class OverlayFrameTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.frames = Path(folder.name)

    def test_portrait_frames_pass(self):
        for index in range(3):
            write_png_header(self.frames / f"{index:05d}.png", 1080, 1920)
        self.assertIsNone(render_final.check_overlay_frames(self.frames, 3))

    def test_landscape_frames_are_refused(self):
        # A kit change once sized the overlay canvas to 1920x1080 and cropped everything below y 1080 (review r6).
        for index in range(3):
            write_png_header(self.frames / f"{index:05d}.png", 1920, 1080)
        self.assertIn("1920x1080", render_final.check_overlay_frames(self.frames, 3))

    def test_a_frame_without_alpha_is_refused_by_name(self):
        # Chrome writes a fully opaque frame as RGB; the format change mid-chunk crashed overlay_cuda (0xC0000005).
        for index in range(3):
            write_png_header(self.frames / f"{index:05d}.png", 1080, 1920, RGB if index == 1 else RGBA)
        self.assertIn("00001.png", render_final.check_overlay_frames(self.frames, 3))

    def test_frame_count_must_match_the_edit(self):
        write_png_header(self.frames / "00000.png", 1080, 1920)
        self.assertIn("1 overlay PNGs", render_final.check_overlay_frames(self.frames, 3))

    def test_gpu_path_needs_opencl_for_the_composite(self):
        with mock.patch.object(render_final, "has_opencl", return_value=False):
            self.assertFalse(render_final.gpu_path(True, ""))
        with mock.patch.object(render_final, "has_opencl", return_value=True):
            self.assertTrue(render_final.gpu_path(True, ""))
            self.assertFalse(render_final.gpu_path(True, "hflip,vflip"))


class FlagTests(unittest.TestCase):
    def test_draft_and_4k_are_exclusive(self):
        self.assertEqual(render_final.parse_flags(["--4k"]), (False, True))
        self.assertEqual(render_final.parse_flags(["--draft"]), (True, False))
        with self.assertRaises(SystemExit):
            render_final.parse_flags(["--draft", "--4k"])


if __name__ == "__main__":
    unittest.main()
