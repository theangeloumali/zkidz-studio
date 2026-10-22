# Created by The Angelo Umali.
# showcase pieces: a 16:9 film needs its own panel, and an HLG raw must be tone-mapped like join_sources' pieces.
import unittest
from unittest import mock
from pathlib import Path

from support import ENGINE  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import join_sources
from zks_engine import showcase


PORTRAIT = {"codec_name": "h264", "width": 1080, "height": 1920, "pix_fmt": "yuv420p"}


def insert_command(first=0, stream=PORTRAIT, **fields):
    insert = {"at": 0.0, "end": 1.0, "src": "films/a.mp4", "src_at": 2.0, **fields}
    with mock.patch.object(showcase, "probe_video", return_value=stream):
        return showcase.insert_command(insert, first, 30, Path("out.mp4"))


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


class PanelForTests(unittest.TestCase):
    def test_a_wider_than_tall_file_gets_the_landscape_panel(self):
        self.assertEqual(showcase.panel_for((1920, 1080)), "landscape")
        self.assertEqual(showcase.panel_for((1080, 1920)), "portrait")
        self.assertEqual(showcase.panel_for((1000, 1000)), "portrait")


class BasePieceTests(unittest.TestCase):
    def test_an_hlg_raw_is_tone_mapped_like_a_joined_clip(self):
        clip = join_sources.Clip(Path("raw.mp4"), 900, hdr=True, zoom=1.0, ten_bit=True)
        command = showcase.base_piece(clip, 30, 60, Path("out.mp4"))
        self.assertEqual(command, join_sources.piece_command(clip, 30, 60, Path("out.mp4")))
        self.assertIn(join_sources.TONEMAP, command[command.index("-vf") + 1])


if __name__ == "__main__":
    unittest.main()
