# Created by The Angelo Umali.
# ffmpeg input policy (plan §7.5): user media is a plain local file, never a playlist, list, URL or image sequence.
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import ffio

HLS_PLAYLIST = "#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:1.0,\nfile:///etc/hostname\n"


class SniffTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)

    def write(self, name, data):
        path = self.root / name
        path.write_bytes(data if isinstance(data, bytes) else data.encode("utf-8"))
        return path

    def assert_rejected(self, path, reason):
        with self.assertRaises(ffio.MediaRejected) as caught:
            ffio.check_user_media(path)
        self.assertIn(reason, str(caught.exception))

    def test_an_m3u8_renamed_mp4_is_rejected(self):
        self.assert_rejected(self.write("holiday.mp4", HLS_PLAYLIST), "playlist")

    def test_a_concat_list_renamed_mov_is_rejected(self):
        self.assert_rejected(self.write("clip.mov", "ffconcat version 1.0\nfile '/etc/passwd'\n"), "concat list")

    def test_a_dash_manifest_and_a_url_file_are_rejected(self):
        self.assert_rejected(self.write("a.mkv", '<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011"/>'), "text")
        self.assert_rejected(self.write("b.mp4", "https://example.com/video.mp4\n"), "text")

    def test_urls_protocols_and_sequences_are_not_local_files(self):
        for spec in ("https://example.com/a.mp4", "concat:a.mp4|b.mp4", "file:a.mp4", "pipe:0"):
            self.assert_rejected(spec, "local file")
        self.assert_rejected(self.write("frame%03d.png", b"\x89PNG\r\n\x1a\n\x00"), "image sequence")

    def test_a_dash_leading_name_and_a_missing_file_are_rejected(self):
        self.assert_rejected(self.write("-i.mp4", b"\x00\x00\x00\x18ftypmp42"), "local file")
        self.assert_rejected(self.root / "missing.mp4", "not a file")

    def test_binary_media_passes_the_sniff(self):
        path = self.write("clip.mp4", b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom")
        self.assertEqual(ffio.check_user_media(path), path.resolve())

    def test_input_args_whitelist_protocols_and_formats(self):
        path = self.write("clip.mp4", b"\x00\x00\x00\x18ftypmp42")
        args = ffio.user_input_args(path)
        self.assertEqual(args[args.index("-protocol_whitelist") + 1], "file,pipe")
        formats = args[args.index("-format_whitelist") + 1].split(",")
        self.assertIn("matroska", formats)
        self.assertNotIn("hls", formats)
        self.assertNotIn("concat", formats)
        self.assertEqual(args[-2:], ["-i", str(path.resolve())])


class ConcatTests(unittest.TestCase):
    def test_quotes_in_paths_are_escaped(self):
        listing = ffio.concat_listing([Path("/home/O'Brien/a.mp4"), Path("/tmp/b.mp4")])
        self.assertEqual(listing, "file '/home/O'\\''Brien/a.mp4'\nfile '/tmp/b.mp4'\n")

    def test_a_newline_in_a_path_is_refused(self):
        with self.assertRaises(ValueError):
            ffio.concat_listing([Path("/tmp/a\nfile '/etc/passwd'.mp4")])

    @unittest.skipUnless(shutil.which("ffmpeg"), "needs ffmpeg")
    def test_a_home_path_with_a_quote_joins(self):
        with tempfile.TemporaryDirectory() as scratch:
            folder = Path(scratch) / "O'Brien"
            folder.mkdir()
            pieces = [folder / f"{index}.mkv" for index in range(2)]
            for piece in pieces:
                subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=64x36:rate=30000/1001:duration=0.2",
                                "-c:v", "ffv1", str(piece)], check=True)
            listing = folder / "pieces.txt"
            listing.write_text(ffio.concat_listing(pieces), encoding="utf-8")
            joined = folder / "joined.mkv"
            subprocess.run(["ffmpeg", "-v", "error", *ffio.concat_input_args(listing), "-c", "copy", str(joined)], check=True)
            frames = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries",
                                     "stream=nb_read_frames", "-of", "csv=p=0", str(joined)], capture_output=True, text=True, check=True)
            self.assertEqual(int(frames.stdout), 12)


@unittest.skipUnless(shutil.which("ffprobe") and shutil.which("ffmpeg"), "needs ffmpeg and ffprobe")
class ProbeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        root = Path(cls.folder.name)
        cls.clip = root / "clip.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=64x36:rate=30000/1001:duration=0.5",
                        "-f", "lavfi", "-i", "sine=duration=0.5:sample_rate=48000", "-c:v", "libx264", "-c:a", "aac", "-ac", "2",
                        "-shortest", str(cls.clip)], check=True)
        cls.still = root / "still.png"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=red:size=8x8", "-frames:v", "1", str(cls.still)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    def test_probe_reports_the_media_contract(self):
        info = ffio.probe(self.clip)
        self.assertEqual(info["fps"], {"num": 30000, "den": 1001})
        self.assertEqual(info["size"], {"width": 64, "height": 36})
        self.assertEqual((info["rotation"], info["hdr"], info["vfr"]), (0, False, False))
        self.assertEqual(info["audio"], {"rate": 48000, "channels": 2})
        self.assertAlmostEqual(info["durationS"], 0.5, delta=0.1)

    def test_a_still_probes_without_audio(self):
        info = ffio.probe(self.still)
        self.assertEqual(info["size"], {"width": 8, "height": 8})
        self.assertIsNone(info["audio"])

    def test_a_concat_demuxer_detection_after_the_sniff_is_rejected(self):
        with self.assertRaises(ffio.MediaRejected):
            ffio.check_probed_format("concat")
        with self.assertRaises(ffio.MediaRejected):
            ffio.check_probed_format("hls")
        ffio.check_probed_format("mov,mp4,m4a,3gp,3g2,mj2")


if __name__ == "__main__":
    unittest.main()
