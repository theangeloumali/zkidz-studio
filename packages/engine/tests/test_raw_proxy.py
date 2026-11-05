# Created by The Angelo Umali.
# A one-clip ingest builds its proxy from the raw, beside the 4K join: proxy frame n must still be source frame n.
import subprocess
import unittest
from pathlib import Path

import numpy

from support import has_ffmpeg  # first: it sets a scratch ZKS_HOME
from test_ingest_progress import FFMPEG_ABSENT, call_cli, scratch_work

from zks_engine import ffio, join_sources, prepare
from zks_engine.render_final import count_frames


def clip_of(frame, frames=300, fps=(30, 1), zoom=1.0, hdr=False):
    return join_sources.Clip(Path("raw.mp4"), frames, hdr, zoom, False, fps=fps, frame=frame)


class RawProxyFilterTests(unittest.TestCase):
    def test_a_portrait_clip_fills_the_proxy_with_no_bars(self):
        video_filter = prepare.raw_proxy_filter(clip_of((1080, 1920)))
        self.assertIn("scale=1080:1920:", video_filter)
        self.assertNotIn("pad=", video_filter)

    def test_a_landscape_clip_is_letterboxed_like_the_join_at_half_its_size(self):
        width, height = join_sources.fitted(clip_of((1920, 1080)))
        video_filter = prepare.raw_proxy_filter(clip_of((1920, 1080)))
        self.assertIn(f"scale={width // 2}:{height // 2}:", video_filter)
        self.assertIn(f"pad=1080:1920:0:{(1920 - height // 2) // 2}:color=black", video_filter)

    def test_frames_are_picked_by_decode_index_and_restamped_onto_the_clip_s_grid(self):
        video_filter = prepare.raw_proxy_filter(clip_of((1080, 1920), frames=300, fps=(30000, 1001)))
        self.assertTrue(video_filter.startswith("select='between(n,0,299)'"), video_filter)
        self.assertIn("settb=1001/30000,setpts=N", video_filter)
        self.assertTrue(video_filter.endswith("sidedata=mode=delete:type=DISPLAYMATRIX"), video_filter)

    def test_hdr_is_tone_mapped_and_a_zoom_crops_the_top_centre_like_the_join(self):
        video_filter = prepare.raw_proxy_filter(clip_of((1080, 1920), zoom=1.25, hdr=True))
        self.assertIn(join_sources.CPU_TONEMAP, video_filter)
        self.assertIn("crop=iw/1.25:ih/1.25:(iw-iw/1.25)/2:0", video_filter)


def frame_at(path, index, size=(135, 240)):
    """Frame `index` by decode order as a small grey image."""
    raw = subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-i", str(path), "-vf", f"select='eq(n,{index})',scale={size[0]}:{size[1]},format=gray",
                          "-frames:v", "1", "-f", "rawvideo", "-"], capture_output=True, check=True).stdout
    return numpy.frombuffer(raw, numpy.uint8).astype(float).reshape(size[1], size[0])


def difference(first, second):
    return float(numpy.mean(numpy.abs(first - second)))


@unittest.skipUnless(has_ffmpeg(), FFMPEG_ABSENT)
class RawProxyFramesTests(unittest.TestCase):
    def setUp(self):
        self.work = scratch_work(self)

    def clip(self, name, size, timing="", rotation=None, audio_s=2):
        """A BT.709-tagged clip, as phones record: the join's CUDA route passes an untagged clip's matrix through unconverted."""
        path = self.work.parent / "media" / name
        path.parent.mkdir(exist_ok=True)
        plain = path.with_name(f"plain-{name}")
        video_filter = ",".join(item for item in (timing, "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p") if item)
        subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-f", "lavfi", "-i", f"testsrc2=size={size}:rate=30:duration=2", "-f", "lavfi", "-i",
                        f"sine=duration={audio_s}", "-vf", video_filter, *(["-fps_mode", "vfr"] if timing else []), "-c:v", "libx264", "-colorspace", "bt709",
                        "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", "-c:a", "aac", "-t", "2", str(plain)], check=True)
        rotate = ["-display_rotation:v:0", str(rotation)] if rotation is not None else []
        subprocess.run([ffio.ffmpeg_bin(), "-v", "error", *rotate, "-i", str(plain), "-c", "copy", str(path)], check=True)
        return path

    def assert_proxy_frames_match_the_source(self, clip):
        code, report = call_cli("ingest", "--json", "--video", "v1", "--mode", "single", "--clip", str(clip))
        self.assertEqual(code, 0)
        proxy, source = self.work / "mezz" / "v1.mp4", self.work / report["sourcePath"]
        frames = count_frames(source)
        self.assertEqual(count_frames(proxy), frames)
        for index in (0, frames // 2, frames - 2):
            ours, same, next_one = frame_at(proxy, index), frame_at(source, index), frame_at(source, index + 1)
            self.assertLess(difference(ours, same), 4, index)
            self.assertLess(difference(ours, same), difference(ours, next_one), index)

    def test_a_landscape_clip_s_proxy_matches_the_joined_source_frame_for_frame(self):
        self.assert_proxy_frames_match_the_source(self.clip("landscape.mp4", "320x180"))

    def test_a_rotated_phone_clip_stands_upright_frame_for_frame(self):
        self.assert_proxy_frames_match_the_source(self.clip("phone.mp4", "320x180", rotation=90))

    def test_a_clip_whose_audio_stops_early_keeps_every_frame(self):
        # The proxy's -shortest cut the video at the audio's end, so its frames stopped matching the source.
        self.assert_proxy_frames_match_the_source(self.clip("short-audio.mp4", "180x320", audio_s=1))

    def test_a_clip_whose_audio_stops_early_gets_a_wav_as_long_as_its_video(self):
        # Cut snapping reads the wav's energy against the video's frames: the joined source pads it, so the fast path must too.
        code, _ = call_cli("ingest", "--json", "--video", "v1", "--mode", "single", "--clip", str(self.clip("short-wav.mp4", "180x320", audio_s=1)))
        self.assertEqual(code, 0)
        seconds = float(subprocess.run([ffio.ffprobe_bin(), "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                                        str(self.work / "audio" / "v1.wav")], capture_output=True, text=True, check=True).stdout)
        self.assertAlmostEqual(seconds, 2.0, delta=0.05)

    def test_a_variable_rate_clip_keeps_the_join_s_decode_index_frames(self):
        self.assert_proxy_frames_match_the_source(self.clip("vfr.mp4", "180x320", "setpts='(N+0.4*sin(N))/(30*TB)'"))


if __name__ == "__main__":
    unittest.main()
