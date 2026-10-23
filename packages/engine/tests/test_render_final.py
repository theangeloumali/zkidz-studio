# Created by The Angelo Umali.
# Unit tests for render_final: range expressions, orientation placement, privacy blur, the soundtrack choice and the
# brand pre-roll spliced in at its insert.
import json
import math
import os
import re
import subprocess
import tempfile
import time
import unittest
import wave
from pathlib import Path
from unittest import mock

import numpy as np
from support import make_edl, media_file, playlist_file, seconds, has_ffmpeg  # first: it sets a scratch ZKS_HOME
from test_gpu_render import write_png_header

from zks_engine import pipeline
from zks_engine import backends
from zks_engine import blur
from zks_engine import ffio
from zks_engine import render_final
from zks_engine.backends import graph as backend_graph

UPRIGHT_4K = (2160, 3840)
CPU = backends.get("cpu")
GPU_ROUTE = render_final.Route(backends.get("nvidia"), True, "", UPRIGHT_4K)
CPU_ROUTE = render_final.Route(CPU, False, "", UPRIGHT_4K)
VAAPI_ROUTE = render_final.Route(backends.get("vaapi"), False, "", UPRIGHT_4K)


class RangeExprTests(unittest.TestCase):
    def test_ranges_grouped_below_parser_limit(self):
        expr = render_final.ranges_expr([(index * 10, index * 10 + 5) for index in range(150)])
        for group in expr.split(")+("):
            self.assertLessEqual(group.count("between("), blur.EXPR_GROUP)

    def test_short_list_stays_flat(self):
        self.assertEqual(render_final.ranges_expr([(0, 10), (20, 30)]), "between(n,0,9)+between(n,20,29)")

    @unittest.skipUnless(has_ffmpeg(), "ffmpeg not installed")
    def test_ffmpeg_parses_150_ranges(self):
        expr = render_final.ranges_expr([(index * 10, index * 10 + 5) for index in range(150)])
        result = subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=32x32:rate=30000/1001:duration=1",
                                 "-vf", f"select='{expr}'", "-f", "null", "-"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_decode_args(self):
        self.assertEqual(pipeline.decode_args(False), [])
        self.assertIn("cuda", pipeline.decode_args(True))

    def test_encoders_come_only_from_the_backend_profile(self):
        # The old cuda-flag picker chose videotoolbox on any Mac without a probe; the ffmpeg whisper filter is gone (spike 04).
        for name in ("video_encoder", "gpu_path", "UHD_ENCODER"):
            self.assertFalse(hasattr(render_final, name), name)
        for name in ("whisper_filter", "filter_path", "models_dir", "WHISPER_MODEL", "VAD_MODEL"):
            self.assertFalse(hasattr(pipeline, name), name)


class GraphTests(unittest.TestCase):
    def test_cpu_graph_has_no_hwdownload_and_drops_rotation(self):
        graph = backend_graph.composite(CPU, make_edl([(0, 30), (60, 90)], [1.0, 1.08]))
        self.assertNotIn("hwdownload", graph)
        self.assertIn("settb=1001/30000,setpts=N", graph)
        self.assertIn(pipeline.DROP_ROTATION, graph)

    def test_no_regions_leaves_no_blur(self):
        graph = backend_graph.composite(CPU, make_edl([(0, 30)]))
        self.assertNotIn("gblur", graph)
        self.assertIn("[upright]split[a][b]", graph)


class RouteTests(unittest.TestCase):
    """Which composite a source takes: nvidia's CUDA/OpenCL graph, or the CPU-filter graph between a backend's decode and encoder."""

    def route(self, name, rotation=0, opencl=True, filters=("transpose_cuda",)):
        stream = {"width": 1920, "height": 1080, "side_data_list": [{"rotation": rotation}] if rotation else []}
        with (mock.patch.object(render_final, "probe_video", return_value=stream), mock.patch.object(render_final, "has_opencl", return_value=opencl),
              mock.patch.object(render_final, "has_filter", side_effect=lambda name: name in filters)):
            return render_final.route_for(Path("clip.mp4"), backends.get(name))

    def test_upright_footage_on_nvidia_takes_the_cuda_composite(self):
        self.assertEqual(self.route("nvidia"), render_final.Route(backends.get("nvidia"), True, "", (1920, 1080)))

    def test_a_quarter_turn_stays_on_cuda_only_when_ffmpeg_has_transpose_cuda(self):
        self.assertEqual(self.route("nvidia", rotation=-90).gpu_turn, "transpose_cuda=dir=clock")
        fallback = self.route("nvidia", rotation=-90, filters=())
        self.assertEqual((fallback.on_gpu, fallback.frame_size), (False, (1080, 1920)))

    def test_a_half_turn_or_no_opencl_takes_the_cpu_filter_graph(self):
        self.assertFalse(self.route("nvidia", rotation=180).on_gpu)
        self.assertFalse(self.route("nvidia", opencl=False).on_gpu)

    def test_every_other_backend_takes_the_cpu_filter_graph(self):
        for name in ("videotoolbox", "qsv", "amf", "vaapi", "cpu"):
            self.assertFalse(self.route(name).on_gpu, name)


class BlurTests(unittest.TestCase):
    timeline = make_edl([(0, 300), (600, 900)])

    def regions(self, *blurs, frame_size=UPRIGHT_4K):
        return render_final.blur_regions({"blur": [list(blur) for blur in blurs]}, self.timeline, frame_size)

    def test_box_scales_to_the_source_clamps_and_snaps_even(self):
        [(x, y, w, h, _)] = self.regions((seconds(10), seconds(20), 1001, -30, 200, 101, "edge"))
        self.assertEqual((x, y, w, h), (2002, 0, 158, 142))

    def test_span_maps_to_edited_frames_across_a_cut(self):
        [(*_, ranges)] = self.regions((seconds(250), seconds(650), 100, 100, 100, 100, "cut"))
        self.assertEqual(ranges, [(250, 350)])

    def test_removed_span_and_off_frame_box_are_dropped(self):
        self.assertEqual(self.regions((seconds(350), seconds(550), 100, 100, 100, 100, "removed")), [])
        self.assertEqual(self.regions((seconds(10), seconds(20), 1100, 100, 100, 100, "outside")), [])

    def test_graph_gates_each_box_and_the_single_overlay_on_edited_frames(self):
        regions = self.regions((seconds(250), seconds(650), 100, 50, 200, 300, "a"), (seconds(10), seconds(20), 0, 0, 50, 50, "b"))
        graph = backend_graph.composite(CPU, self.timeline, regions=regions, frame_size=UPRIGHT_4K)
        # Box (200, 100, 400, 600) on the 1/8 grid (25, 12, 50, 76), one cell wider on every side so the upscale's
        # edge ramp falls outside the box, not over its text.
        self.assertIn("drawbox=x=24:y=11:w=52:h=78:color=white:t=fill:enable='between(n,250,349)'", graph)
        self.assertIn("overlay=0:0:format=yuv420:enable='between(n,10,19)+between(n,250,349)'", graph)
        self.assertIn("alphamerge,format=yuva420p,scale=2160:3840", graph)
        self.assertIn("[blurred]split[a][b]", graph)

    def test_blur_cost_does_not_grow_with_regions(self):
        # One split -> crop -> overlay chain per region took v5 (18 regions) from 145 fps to 2.6 fps.
        many = self.regions(*[(seconds(10), seconds(20), 10 * i, 10 * i, 100, 100, str(i)) for i in range(18)])
        graph = backend_graph.composite(CPU, self.timeline, regions=many, frame_size=UPRIGHT_4K)
        self.assertEqual(graph.count("drawbox="), 18)
        self.assertEqual((graph.count("alphamerge"), graph.count("gblur"), graph.count("overlay=0:0")), (1, 1, 1))

    @unittest.skipUnless(has_ffmpeg(), "ffmpeg not installed")
    def test_ffmpeg_runs_the_graph_with_and_without_regions(self):
        # A small upright stand-in for the 4K source keeps this fast; the graph shape is the same.
        timeline = make_edl([(0, 10), (20, 30)], [1.0, 1.08])
        for blurs in ([], [[0, seconds(25), 0, 0, 1080, 400, "a"], [seconds(5), seconds(22), 500, 1500, 900, 900, "b"]]):
            regions = render_final.blur_regions({"blur": blurs}, timeline, (432, 768))
            graph = backend_graph.composite(CPU, timeline, regions=regions, frame_size=(432, 768))
            result = subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=432x768:rate=30000/1001:duration=1",
                                     "-f", "lavfi", "-i", "color=black@0:size=1080x1920:rate=30000/1001:duration=1,format=rgba",
                                     "-filter_complex", graph, "-map", "[v]", "-f", "null", "-"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)


class SoundtrackTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.work = Path(folder.name)
        for sub in ("audio", "edl"):
            (self.work / sub).mkdir()
        patcher = mock.patch.object(render_final, "WORK", self.work)
        patcher.start()
        self.addCleanup(patcher.stop)

    def touch(self, relative, age):
        path = self.work / relative
        path.write_bytes(b"")
        stamp = time.time() - age
        os.utime(path, (stamp, stamp))

    def test_edit_without_sfx_uses_the_plain_edit(self):
        self.touch("audio/v1_edit.wav", 10)
        self.assertEqual(render_final.soundtrack("v1").name, "v1_edit.wav")

    def test_fresh_mix_wins(self):
        self.touch("audio/v1_edit.wav", 30)
        self.touch("edl/v1.sfx.json", 20)
        self.touch("audio/v1_mix.wav", 10)
        self.assertEqual(render_final.soundtrack("v1").name, "v1_mix.wav")

    def test_stale_or_missing_mix_is_refused(self):
        self.touch("audio/v1_edit.wav", 10)
        self.touch("edl/v1.sfx.json", 30)
        with self.assertRaises(SystemExit):
            render_final.soundtrack("v1")
        self.touch("audio/v1_mix.wav", 20)
        with self.assertRaises(SystemExit):
            render_final.soundtrack("v1")



@unittest.skipUnless(has_ffmpeg(), "needs ffmpeg")
class RestampTests(unittest.TestCase):
    def test_a_1_1000_mkv_lands_exactly_on_the_png_grid(self):
        """Joined sources are .mkv (time base 1/1000): setpts=N*1001 put frames 1.001 s apart (v8/v11, 2026-09-28)."""
        with tempfile.TemporaryDirectory() as folder:
            clip = Path(folder) / "clip.mkv"
            subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=64x64:rate=30000/1001:duration=0.5",
                            "-c:v", "ffv1", str(clip)], check=True)
            graph = f"select='between(n,0,9)',{render_final.restamp(make_edl([(0, 30)]))},showinfo"
            log = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(clip), "-vf", graph, "-f", "null", "-"],
                                 capture_output=True, text=True).stderr
        times = [float(value) for value in re.findall(r"pts_time:([0-9.]+)", log)]
        self.assertEqual(len(times), 10, log[-500:])
        for index, value in enumerate(times):
            self.assertAlmostEqual(value, index * 1001 / 30000, places=6)


class IntroTests(unittest.TestCase):
    """A brand pre-roll declared in edl/<v>.sfx.json renders as its own chunk, joined at its insert (intro.at), its track
    spliced into the edit's there; anything missing or stale stops the render with the step to re-run."""

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.work = Path(folder.name)
        for sub in ("audio", "edl", "frames/v1.intro"):
            (self.work / sub).mkdir(parents=True)
        for module in (render_final, pipeline):  # pipeline.intro_track resolves the track from its own WORK
            patcher = mock.patch.object(module, "WORK", self.work)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.edl = make_edl([(0, 90)])
        self.write_payload({"frames": 90, "events": [], "intro": {"frames": 60, "events": [], "at": 45}}, age=20)
        self.write_drawn_insert(45)

    def write_drawn_insert(self, at):
        (self.work / "frames" / "v1.insert.json").write_text(json.dumps({"at": at}), encoding="utf-8")

    def write_payload(self, payload, age):
        path = self.work / "edl" / "v1.sfx.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        os.utime(path, (time.time() - age, time.time() - age))

    def write_frames(self, count):
        for index in range(count):
            write_png_header(self.work / "frames" / "v1.intro" / f"{index:05d}.png", 1080, 1920)

    def write_track(self, samples):
        with wave.open(str(self.work / "audio" / "v1_intro.wav"), "wb") as track:
            track.setnchannels(2)
            track.setsampwidth(3)
            track.setframerate(48000)
            track.writeframes(bytes(6 * samples))

    def test_an_edit_without_an_intro_has_none(self):
        self.write_payload({"frames": 90, "events": []}, age=20)
        self.assertIsNone(render_final.intro_of("v1", self.edl))
        (self.work / "edl" / "v1.sfx.json").unlink()
        self.assertIsNone(render_final.intro_of("v1", self.edl))

    def test_a_complete_intro_is_found(self):
        self.write_frames(60)
        self.write_track(96096)
        intro = render_final.intro_of("v1", self.edl)
        self.assertEqual((intro["frames"], intro["audio"].name, intro["at"]), (60, "v1_intro.wav", 45))

    def test_an_intro_without_its_insert_point_stops_the_render(self):
        self.write_frames(60)
        self.write_track(96096)
        self.write_payload({"frames": 90, "events": [], "intro": {"frames": 60, "events": []}}, age=20)
        with self.assertRaisesRegex(SystemExit, "sfx.py"):
            render_final.intro_of("v1", self.edl)

    def test_frames_drawn_for_another_insert_stop_the_render(self):
        self.write_frames(60)
        self.write_track(96096)
        self.write_drawn_insert(44)
        with self.assertRaisesRegex(SystemExit, "hf/render.js"):
            render_final.intro_of("v1", self.edl)
        (self.work / "frames" / "v1.insert.json").unlink()
        with self.assertRaisesRegex(SystemExit, "hf/render.js"):
            render_final.intro_of("v1", self.edl)

    def test_the_chunks_break_at_the_insert(self):
        before, after = render_final.intro_bounds(9000, 120, 4)
        self.assertEqual((before[0][0], before[-1][1], after[0][0], after[-1][1]), (0, 120, 120, 9000))
        self.assertEqual(len(before) + len(after), 4)
        self.assertTrue(all(first < last for first, last in before + after))

    def test_missing_frames_or_a_wrong_track_stop_the_render(self):
        self.write_track(96096)
        self.write_frames(59)
        with self.assertRaisesRegex(SystemExit, "brand intro"):
            render_final.intro_of("v1", self.edl)
        self.write_frames(60)
        self.write_track(96000)
        with self.assertRaisesRegex(SystemExit, "sfx.py"):
            render_final.intro_of("v1", self.edl)
        self.write_track(96096)
        self.write_payload({"frames": 90, "events": [], "intro": {"frames": 60, "events": [], "at": 45}}, age=-20)  # newer than the track
        with self.assertRaisesRegex(SystemExit, "sfx.py"):
            render_final.intro_of("v1", self.edl)

    def test_the_intro_chunk_scales_on_the_gpu_and_encodes_like_the_edit(self):
        intro = {"frames": 60, "frames_dir": self.work / "frames" / "v1.intro"}
        command = render_final.intro_command(intro, self.edl, render_final.UHD, backends.get("nvidia").uhd, self.work / "intro.mp4", GPU_ROUTE)
        graph = command[command.index("-vf") + 1]
        self.assertIn("libplacebo=w=2160:h=3840", graph)
        self.assertEqual(command[command.index("-frames:v") + 1], "60")
        self.assertEqual(command[command.index("-start_number") + 1], "0")
        joined = " ".join(command)
        self.assertIn(" ".join(backends.get("nvidia").uhd), joined)
        self.assertIn(" ".join(render_final.BT709_TAGS), joined)

    def test_every_chunk_writes_its_progress_and_the_total_reads_the_last_frame(self):
        intro = {"frames": 60, "frames_dir": self.work / "frames" / "v1.intro"}
        command = render_final.intro_command(intro, self.edl, render_final.UHD, backends.get("nvidia").uhd, self.work / "intro.mp4", GPU_ROUTE)
        self.assertEqual(command[command.index("-progress") + 1], str(self.work / "intro.progress"))
        report = self.work / "00.progress"
        report.write_text("frame=10\nprogress=continue\nframe=42\nprogress=continue\n", encoding="utf-8")
        self.assertEqual(render_final.frames_written(report), 42)
        self.assertEqual(render_final.frames_written(self.work / "missing.progress"), 0)

    def test_the_join_splices_the_intro_track_into_the_edits_at_the_insert(self):
        listing, edit, track = self.work / "chunks.txt", self.work / "mix.wav", self.work / "intro.wav"
        command = render_final.join_command(listing, edit, backends.get("nvidia").uhd, self.work / "out.mp4", track, 72072)
        inputs = [command[index + 1] for index, arg in enumerate(command) if arg == "-i"]
        self.assertEqual(inputs, [str(listing), str(track), str(edit)])
        graph = command[command.index("-filter_complex") + 1]
        self.assertIn("atrim=end_sample=72072", graph)
        self.assertIn("atrim=start_sample=72072", graph)
        self.assertIn("[1:a]", graph)
        self.assertIn("concat=n=3:v=0:a=1[a]", graph)
        plain = render_final.join_command(listing, edit, backends.get("nvidia").uhd, self.work / "out.mp4")
        self.assertEqual([plain[index + 1] for index, arg in enumerate(plain) if arg == "-i"], [str(listing), str(edit)])
        self.assertEqual(plain[plain.index("-map", plain.index("-map") + 1) + 1], "1:a")

    @unittest.skipUnless(has_ffmpeg(), "needs ffmpeg")
    def test_the_spliced_soundtrack_pauses_the_edit_for_the_intro(self):
        # A tone for the edit, silence for the intro: the tone stops at the insert and resumes 60 frames later.
        def write(path, samples):
            with wave.open(str(path), "wb") as track:
                track.setnchannels(2)
                track.setsampwidth(2)
                track.setframerate(48000)
                track.writeframes(np.repeat(samples, 2).astype("<i2").tobytes())

        edit, track, chunk = self.work / "mix.wav", self.work / "intro.wav", self.work / "chunk.mp4"
        tone = 8000 * np.sin(2 * np.pi * 440 * np.arange(144144) / 48000)
        write(edit, tone)
        write(track, np.zeros(96096))
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=size=32x32:rate=30000/1001", "-frames:v", "150", "-c:v", "mpeg4",
                        str(chunk)], check=True)
        listing = self.work / "chunks.txt"
        listing.write_text(f"file '{chunk.as_posix()}'\n", encoding="utf-8")
        out = self.work / "out.mp4"
        subprocess.run(render_final.join_command(listing, edit, [], out, track, 72072), check=True)
        decoded = subprocess.run(["ffmpeg", "-v", "error", "-i", str(out), "-ac", "1", "-f", "f32le", "-"], capture_output=True, check=True).stdout
        audio = np.frombuffer(decoded, dtype="<f4")
        self.assertLessEqual(abs(len(audio) - 240240), 2048)
        level = lambda first, last: float(np.sqrt(np.mean(audio[int(first * 48000):int(last * 48000)] ** 2)))
        self.assertGreater(level(0.2, 1.4), 0.1)
        self.assertLess(level(1.7, 3.3), 0.001)
        self.assertGreater(level(3.7, 4.8), 0.1)

    def test_off_the_cuda_path_the_intro_scales_on_the_cpu_and_uploads_like_the_edit(self):
        intro = {"frames": 60, "frames_dir": self.work / "frames" / "v1.intro"}
        vaapi = VAAPI_ROUTE.backend
        command = render_final.intro_command(intro, self.edl, render_final.UHD, vaapi.uhd, self.work / "intro.mp4", VAAPI_ROUTE)
        self.assertEqual(command[command.index("-vf") + 1], backend_graph.intro_filter(vaapi, render_final.UHD))
        self.assertLess(command.index("vaapi=va:/dev/dri/renderD128"), command.index("-i"))

    def test_zooms_and_the_matte_refuse_the_cpu_filter_graph(self):
        for extra in ({"zooms": [{"start": 0, "end": 10, "preset": "snap", "cx": 0.5, "cy": 0.5}]}, {"matte": [{"start": 0, "end": 10}]}):
            with self.assertRaisesRegex(SystemExit, "NVIDIA"):
                render_final.encode_master("v1", {**self.edl, **extra}, {}, None, CPU_ROUTE, render_final.OUTPUT, [], None, None, None)


if __name__ == "__main__":
    unittest.main()


class ZoomGraphTests(unittest.TestCase):
    """Animated footage zoom: one libplacebo crop whose expression holds the punch-in and every zoom window."""

    def zoomed(self, zooms=None, ranges=((0, 90),), punches=None):
        spec = make_edl(list(ranges), punches)
        spec["zooms"] = zooms if zooms is not None else [{"start": 30, "end": 60, "preset": "snap", "cx": 0.5, "cy": 0.5}]
        return spec

    def test_zoom_free_edit_keeps_the_punch_in_overlay(self):
        graph = render_final.gpu_graph(make_edl([(0, 30), (60, 90)], [1.0, 1.08]), "")
        self.assertIn("overlay_cuda", graph)
        self.assertNotIn("libplacebo", graph)

    def test_zoom_edit_crops_once_on_libplacebo_after_download(self):
        graph = render_final.gpu_graph(self.zoomed(), "")
        self.assertNotIn("overlay_cuda", graph)
        self.assertEqual(graph.count("libplacebo="), 1)
        self.assertLess(graph.index("hwdownload"), graph.index("libplacebo"))
        self.assertIn("crop_w=", graph)

    def test_snap_lands_at_1_3x_in_five_frames_and_starts_at_1x(self):
        self.assertAlmostEqual(render_final.zoom_factor("snap", 0, 60), 1.0)
        self.assertGreaterEqual(render_final.zoom_factor("snap", 5, 60), 1.29)
        self.assertLessEqual(render_final.zoom_factor("snap", 59, 60), 1.3 + 1e-9)

    def test_reveal_starts_wide_and_settles_at_1x(self):
        self.assertGreater(render_final.zoom_factor("reveal", 0, 90), 1.5)
        self.assertAlmostEqual(render_final.zoom_factor("reveal", 89, 90), 1.0, places=3)

    def test_expression_matches_the_python_curve(self):
        expr = render_final.scale_expr(self.zoomed())
        for frame in (0, 30, 33, 35, 59, 61):
            value = pipeline_eval(expr, frame / pipeline.FPS)
            expected = render_final.zoom_factor("snap", frame - 30, 30) if 30 <= frame < 60 else 1.0
            self.assertAlmostEqual(value, expected, places=4, msg=frame)

    def test_punched_segment_multiplies_into_the_zoom(self):
        spec = self.zoomed(zooms=[], ranges=((0, 30), (40, 70)), punches=[1.0, 1.08])
        expr = render_final.scale_expr(spec)
        self.assertAlmostEqual(pipeline_eval(expr, 10 / pipeline.FPS), 1.0, places=4)
        self.assertAlmostEqual(pipeline_eval(expr, 45 / pipeline.FPS), 1.08, places=4)

    def test_slice_keeps_zooms_on_their_frames(self):
        piece = render_final.edl_slice(self.zoomed(), 20, 90)
        self.assertEqual((piece["zooms"][0]["start"], piece["zooms"][0]["end"]), (10, 40))

    def test_blur_inside_a_zoom_window_is_refused(self):
        with self.assertRaises(SystemExit):
            render_final.gpu_graph(self.zoomed(), "", regions=[(0, 0, 64, 64, [(40, 50)])])

    def test_zoom_chunk_command_opens_a_vulkan_device(self):
        command = render_final.device_args(self.zoomed())
        self.assertIn("vulkan=vk", " ".join(command))
        self.assertNotIn("vulkan", " ".join(render_final.device_args(make_edl([(0, 30)]))))


def pipeline_eval(expr, t):
    """ffmpeg's expression language for the operators scale_expr emits, evaluated in Python at time t."""
    import math

    names = {"t": t, "gte": lambda a, b: float(a >= b), "lt": lambda a, b: float(a < b), "if": lambda c, a, b: a if c else b,
             "exp": math.exp, "min": min, "max": max, "sin": math.sin, "cos": math.cos, "PI": math.pi, "pow": math.pow}
    return eval(expr.replace("if(", "if_(").replace("\\,", ","), {"__builtins__": {}}, {**names, "if_": names["if"]})


class PortalCurveTests(unittest.TestCase):
    def test_portal_accelerates_into_its_fill_scale(self):
        item = {"start": 0, "end": 30, "preset": "portal", "cx": 0.5, "cy": 0.4, "to": 2.0}
        self.assertAlmostEqual(render_final.zoom_factor("portal", 0, 30, item), 1.0)
        self.assertLess(render_final.zoom_factor("portal", 15, 30, item), 1.2)
        self.assertAlmostEqual(render_final.zoom_factor("portal", 29, 30, item), 2.0)
        spec = make_edl([(0, 30)])
        spec["zooms"] = [item]
        self.assertAlmostEqual(pipeline_eval(render_final.scale_expr(spec), 29 / pipeline.FPS), 2.0, places=4)


class FarWindowTests(unittest.TestCase):
    def test_frames_long_before_a_window_stay_finite(self):
        # exp(-k/1.2) with k = frame - start overflowed to inf before a late window; inf * 0 is NaN and crashed libplacebo.
        spec = make_edl([(0, 6000)])
        spec["zooms"] = [{"start": 4600, "end": 4700, "preset": preset, "cx": 0.5, "cy": 0.5} for preset in ("snap",)]
        spec["zooms"] += [{"start": 5000, "end": 5100, "preset": "through-in", "cx": 0.5, "cy": 0.5}]
        for frame in (0, 4599, 4650, 5050):
            value = pipeline_eval(render_final.scale_expr(spec), frame / pipeline.FPS)
            self.assertTrue(math.isfinite(value) and value >= 1.0, (frame, value))


class MatteGraphTests(unittest.TestCase):
    """Depth: the behind layer over the footage, the footage back where the matte says he is, then the front layer."""

    def matted(self):
        spec = make_edl([(0, 90)])
        spec["matte"] = [{"start": 10, "end": 40}]
        return spec

    def test_matte_edit_merges_behind_layer_under_him(self):
        graph = render_final.gpu_graph(self.matted(), "")
        self.assertIn("[2:v]", graph)
        self.assertIn("[3:v]", graph)
        self.assertLess(graph.index("maskedmerge"), graph.index("overlay_opencl"))

    def test_mask_takes_the_footage_crop(self):
        graph = render_final.gpu_graph(self.matted(), "")
        crops = re.findall(r"libplacebo=w=\d+:h=\d+:crop_w='([^']*)'", graph)
        self.assertEqual(len(crops), 2)
        self.assertEqual(crops[0], crops[1])

    def test_edit_without_matte_has_no_merge(self):
        self.assertNotIn("maskedmerge", render_final.gpu_graph(make_edl([(0, 90)]), ""))

    def test_matte_inputs_follow_the_overlay_frames(self):
        inputs = render_final.matte_inputs(self.matted(), 0, Path("frames/v1.behind"), Path("mask/v1.mkv"), 1.5)
        self.assertIn(str(Path("frames/v1.behind") / "%05d.png"), inputs)
        self.assertEqual(inputs[inputs.index(str(Path("mask/v1.mkv"))) - 1 - 0], "-i")


class UserMediaInputTests(unittest.TestCase):
    """The source a cut spec names is user media: sniffed and whitelisted before ffmpeg opens it (ffio policy)."""

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.clip = media_file("clip.mp4")
        self.playlist = playlist_file()

    def chunk(self, source):
        piece = make_edl([(0, 30)])
        return render_final.chunk_command(piece, 0, {}, source, GPU_ROUTE, UPRIGHT_4K, [], self.root / "frames", self.root / "c.mp4")

    def test_a_cpu_filter_chunk_decodes_with_its_backend_and_runs_the_composite(self):
        piece = make_edl([(0, 30)])
        with mock.patch.object(render_final, "frame_times", return_value=[0.0, 0.033]):
            command = render_final.chunk_command(piece, 0, {}, self.clip, VAAPI_ROUTE, render_final.OUTPUT, [], self.root / "frames", self.root / "c.mp4")
        self.assertEqual(command[command.index("-filter_complex") + 1], backend_graph.composite(VAAPI_ROUTE.backend, piece, frame_size=UPRIGHT_4K))
        hardware = " ".join(command[:command.index("-ss")])
        self.assertIn("-init_hw_device vaapi=va:/dev/dri/renderD128 -filter_hw_device va -hwaccel vaapi -hwaccel_device va", hardware)
        self.assertNotIn("opencl", " ".join(command))

    def test_the_chunk_command_reads_the_source_under_the_whitelists(self):
        with mock.patch.object(render_final, "frame_times", return_value=[0.0, 0.033]):
            command = self.chunk(self.clip)
        source_at = command.index(str(self.clip.resolve()))
        self.assertEqual(command[source_at - 1], "-i")
        self.assertEqual(command[source_at - 1 - len(ffio.WHITELISTS):source_at - 1], ffio.WHITELISTS)

    def test_a_playlist_named_mp4_never_reaches_ffmpeg(self):
        with mock.patch.object(render_final.subprocess, "run") as run, self.assertRaises(ffio.MediaRejected):
            self.chunk(self.playlist)
        run.assert_not_called()

    def test_frame_times_rejects_a_playlist_before_ffprobe_runs(self):
        with mock.patch.object(render_final.subprocess, "run") as run, self.assertRaises(ffio.MediaRejected):
            render_final.frame_times(self.playlist)
        run.assert_not_called()

    def test_the_cpu_path_rejects_a_playlist_before_ffmpeg_runs(self):
        edl = make_edl([(0, 30)])
        with (mock.patch.object(render_final.subprocess, "run") as run, mock.patch("zks_engine.pipeline.subprocess.run") as probe,
              self.assertRaises(ffio.MediaRejected)):
            render_final.encode_master("v1", edl, {}, self.playlist, CPU_ROUTE, UPRIGHT_4K, [], self.root / "frames", self.root / "a.wav",
                                       self.root / "out.mp4")
        run.assert_not_called()
        probe.assert_not_called()

    def test_the_composite_runs_the_pinned_ffmpeg(self):
        with mock.patch.dict(os.environ, {"ZKS_FFMPEG": "/pinned/bin/ffmpeg"}), \
             mock.patch.object(render_final, "frame_times", return_value=[0.0, 0.033]):
            self.assertEqual(self.chunk(self.clip)[0], "/pinned/bin/ffmpeg")
