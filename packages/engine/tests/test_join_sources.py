# Created by The Angelo Umali.
# join_sources pieces: hwdownload cannot convert NVDEC surfaces, so each clip downloads in its own bit depth.
import unittest
from pathlib import Path

from support import media_file  # first: it sets a scratch ZKS_HOME

from zks_engine import join_sources


def piece_filter(clip):
    command = join_sources.piece_command(clip, 0, 30, Path("out.mp4"))
    return command[command.index("-vf") + 1]


class PieceCommandTests(unittest.TestCase):
    def test_an_8_bit_clip_downloads_nv12(self):
        clip = join_sources.Clip(media_file("a.mp4"), 30, hdr=False, zoom=1.0, ten_bit=False)
        self.assertIn("hwdownload,format=nv12,", piece_filter(clip))

    def test_a_10_bit_clip_downloads_p010le(self):
        clip = join_sources.Clip(media_file("a.mp4"), 30, hdr=True, zoom=1.0, ten_bit=True)
        self.assertIn("hwdownload,format=p010le,", piece_filter(clip))

    def test_a_portrait_phone_clip_turns_upright_on_the_gpu(self):
        # iPhone stores 3840x2160 with a -90 display matrix; NVDEC frames are never autorotated (#39).
        clip = join_sources.Clip(media_file("a.mov"), 30, hdr=True, zoom=1.0, ten_bit=True, rotation=270)
        self.assertIn("transpose_cuda=dir=clock,hwdownload,format=p010le,", piece_filter(clip))

    def test_the_display_matrix_is_dropped_so_players_do_not_turn_it_again(self):
        clip = join_sources.Clip(media_file("a.mov"), 30, hdr=True, zoom=1.0, ten_bit=True, rotation=270)
        self.assertIn("sidedata=mode=delete:type=DISPLAYMATRIX", piece_filter(clip))

    def test_an_unrotated_clip_is_not_turned(self):
        clip = join_sources.Clip(media_file("a.mp4"), 30, hdr=True, zoom=1.0, ten_bit=True)
        self.assertNotIn("transpose", piece_filter(clip))


if __name__ == "__main__":
    unittest.main()
