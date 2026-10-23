# Created by The Angelo Umali.
# showcase pieces: a 16:9 film needs its own panel, and an HLG raw must be tone-mapped like join_sources' pieces.
import subprocess
import unittest
from unittest import mock
from pathlib import Path

from support import media_file, media_project, has_ffmpeg  # first: it sets a scratch ZKS_HOME

from zks_engine import backends, ffio, join_sources
from zks_engine import showcase

NVIDIA, CPU = backends.get("nvidia"), backends.get("cpu")
PORTRAIT = {"codec_name": "h264", "width": 1080, "height": 1920, "pix_fmt": "yuv420p"}


def insert_command(first=0, stream=PORTRAIT, backend=NVIDIA, fps=(30000, 1001), **fields):
    insert = {"at": 0.0, "end": 1.0, "src": str(media_file("a.mp4")), "src_at": 2.0, **fields}
    with (mock.patch.object(showcase, "probe_video", return_value=stream), mock.patch.object(join_sources, "has_filter", return_value=True),
          media_project()):
        return showcase.insert_command(insert, first, 30, Path("out.mp4"), backend, fps)


def insert_graph(**fields):
    command = insert_command(**fields)
    return command[command.index("-filter_complex") + 1]


class InsertPanelTests(unittest.TestCase):
    def test_an_insert_without_a_panel_takes_its_files_shape(self):
        graph = insert_graph()
        self.assertIn("libplacebo=w=1148:h=2040:corner_rounding", graph)
        self.assertIn("pos_x='if(eq(idx,0),0,506)':pos_y='if(eq(idx,0),0,760)'", graph)

    def test_a_wide_file_without_a_panel_gets_the_landscape_one(self):
        self.assertIn("libplacebo=w=2048:h=1152:corner_rounding", insert_graph(stream={**PORTRAIT, "width": 1920, "height": 1080}))

    def test_an_explicit_panel_overrides_the_files_shape(self):
        self.assertIn("libplacebo=w=1148:h=2040", insert_graph(panel="portrait", stream={**PORTRAIT, "width": 1920, "height": 1080}))

    def test_a_10_bit_file_downloads_p010le(self):
        self.assertIn("hwdownload,format=p010le,", insert_graph(stream={**PORTRAIT, "pix_fmt": "yuv420p10le"}))

    def test_the_seek_follows_the_frame_grid_so_picture_and_clean_sound_agree(self):
        # at 10.0 s falls between frames: frame 300 is at 10.0100 s, so the file is read 10 ms later too.
        command = insert_command(first=300, at=10.0, panel="portrait")
        self.assertEqual(command[command.index("-ss") + 1], f"{2.0 + 300 * 1001 / 30000 - 10.0:.4f}")

    def test_a_file_stored_sideways_is_turned_upright_on_the_gpu_and_framed_by_its_upright_shape(self):
        sideways = {**PORTRAIT, "width": 1920, "height": 1080, "side_data_list": [{"rotation": -90}]}
        graph = insert_graph(stream=sideways)
        self.assertTrue(graph.startswith("[0:v]transpose_cuda=dir=clock,hwdownload"))
        self.assertIn("libplacebo=w=1148:h=2040", graph)

    def test_a_landscape_insert_composes_a_16_9_panel_at_its_box(self):
        graph = insert_graph(panel="landscape")
        self.assertIn("libplacebo=w=2048:h=1152:corner_rounding", graph)
        self.assertIn("pos_x='if(eq(idx,0),0,56)':pos_y='if(eq(idx,0),0,1000)'", graph)
        self.assertIn("pos_w='if(eq(idx,0),2160,2048)':pos_h='if(eq(idx,0),3840,1152)'", graph)


class BackendInsertTests(unittest.TestCase):
    def test_only_nvidia_opens_a_vulkan_device_for_libplacebo(self):
        # A Mac, QSV, AMF, VAAPI or CPU host may have no Vulkan; its panel is rounded with CPU filters instead.
        self.assertIn("vulkan", insert_command(backend=NVIDIA))
        for name in ("videotoolbox", "qsv", "amf", "vaapi", "cpu"):
            command = " ".join(insert_command(backend=backends.get(name)))
            self.assertNotIn("vulkan", command, name)
            self.assertNotIn("libplacebo", command, name)

    def test_off_nvidia_the_rounded_panel_is_masked_and_overlaid_at_its_box(self):
        graph = insert_graph(backend=CPU, panel="landscape")
        self.assertIn("[b]scale=2048:1152:flags=bicubic[pv]", graph)
        self.assertIn("color=c=black:s=2048x1152", graph)
        self.assertIn("[pv][mask]alphamerge[panel];[fill][panel]overlay=56:1000", graph)

    @unittest.skipUnless(has_ffmpeg(), "needs ffmpeg")
    def test_the_cpu_insert_graph_runs_in_ffmpeg(self):
        graph = insert_graph(backend=CPU, panel="portrait").replace("[0:v]", "[0:v]format=yuv420p,", 1)
        result = subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30000/1001:duration=0.2",
                                 "-filter_complex", graph, "-map", "[v]", "-frames:v", "6", "-f", "null", "-"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_off_nvidia_the_insert_decodes_to_system_frames_and_uploads_for_its_encoder(self):
        vaapi = backends.get("vaapi")
        command = insert_command(backend=vaapi, stream={**PORTRAIT, "pix_fmt": "yuv420p10le"})
        graph = command[command.index("-filter_complex") + 1]
        self.assertTrue(graph.startswith("[0:v]settb=1001/30000,setpts=N,split[a][b]"))
        self.assertTrue(graph.endswith(",format=nv12,hwupload[v]"))
        self.assertIn("-hwaccel vaapi -hwaccel_device va -ss", " ".join(command))
        self.assertEqual(command[command.index("-c:v"):command.index("-an")], vaapi.mezzanine)

    def test_the_seek_and_grid_follow_the_raws_own_rate(self):
        command = insert_command(first=250, at=10.0, panel="portrait", fps=(25, 1), backend=CPU)
        self.assertEqual(command[command.index("-ss") + 1], f"{2.0 + 250 / 25 - 10.0:.4f}")
        self.assertEqual(command[command.index("-r") + 1], "25/1")
        self.assertIn("settb=1/25,setpts=N", command[command.index("-filter_complex") + 1])

    def test_the_plan_reads_insert_times_on_the_raws_grid(self):
        self.assertEqual(showcase.plan([{"at": 2.0, "end": 3.0}], 100, (25, 1))[1][:2], (50, 25))


class PanelForTests(unittest.TestCase):
    def test_a_wider_than_tall_file_gets_the_landscape_panel(self):
        self.assertEqual(showcase.panel_for((1920, 1080)), "landscape")
        self.assertEqual(showcase.panel_for((1080, 1920)), "portrait")
        self.assertEqual(showcase.panel_for((1000, 1000)), "portrait")


class BasePieceTests(unittest.TestCase):
    def test_an_hlg_raw_is_tone_mapped_like_a_joined_clip(self):
        clip = join_sources.Clip(media_file("raw.mp4"), 900, hdr=True, zoom=1.0, ten_bit=True)
        command = showcase.base_piece(clip, 30, 60, Path("out.mp4"), NVIDIA)
        self.assertEqual(command, join_sources.piece_command(clip, 30, 60, Path("out.mp4"), NVIDIA))
        self.assertIn(join_sources.TONEMAP, command[command.index("-vf") + 1])

    def test_an_sdr_raw_on_nvidia_stays_on_cuda_frames(self):
        clip = join_sources.Clip(media_file("raw.mp4"), 900, hdr=False, zoom=1.0, ten_bit=False)
        with mock.patch.object(showcase, "frame_times", return_value=[0.0, 0.033] * 50):
            command = showcase.base_piece(clip, 30, 60, Path("out.mp4"), NVIDIA)
        self.assertIn("colorspace_cuda=range=tv", command[command.index("-vf") + 1])

    def test_every_other_backend_cuts_the_raw_like_a_joined_clip(self):
        clip = join_sources.Clip(media_file("raw.mp4"), 900, hdr=False, zoom=1.0, ten_bit=False)
        self.assertEqual(showcase.base_piece(clip, 30, 60, Path("out.mp4"), CPU), join_sources.piece_command(clip, 30, 60, Path("out.mp4"), CPU))


if __name__ == "__main__":
    unittest.main()
