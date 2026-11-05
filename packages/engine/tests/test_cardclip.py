# Created by The Angelo Umali.
# cardclip: the clips footage cues play inside the overlay, from edl/<v>.clips.json (hf/build.js --clips): which source
# frames each shows, its grade and blur, the backend's encoder, and an NVENC encode of a fixture clip.
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
from support import NTSC, has_ffmpeg, make_edl, media_file, seconds  # first: it sets a scratch ZKS_HOME

from zks_engine import backends, blur, cardclip, ffio, pipeline, render_final
from zks_engine.backends.graph import BT709_TV
from zks_engine.pipeline import OUTPUT

NVIDIA, CPU = backends.get("nvidia"), backends.get("cpu")
GRADED = {"house": "eq=contrast=1.03:saturation=1.05", "learning": "curves=all='0/0 1/0.98'"}


def grade_of(edl):
    """Stands in for render_final.grade_of (the render-path slice's): the edit's grade filter by name."""
    return GRADED[edl.get("grade", "house")]


def setUpModule():
    patcher = mock.patch.object(render_final, "grade_of", grade_of, create=True)
    patcher.start()
    unittest.addModuleCleanup(patcher.stop)


CLIP = {"id": "footageCard-0123456789", "kind": "footageCard", "at": 1.0, "firstFrame": 30, "frames": 50, "grade": "edit",
        "ranges": [[30, 60, False], [100, 120, False]], "file": "cardclips/cc-footageCard-0123456789.mp4"}
EDL = {**make_edl([(0, 60), (100, 200)]), "grade": "learning"}
MEZZ, SOURCE_4K = media_file("mezz.mp4"), media_file("v23.mkv")


def graph_of(args):
    return args[args.index("-filter_complex") + 1]


class GradeTests(unittest.TestCase):
    def test_edit_takes_the_edits_grade_and_raw_takes_none(self):
        self.assertEqual(cardclip.look({}, "edit"), GRADED["house"])
        self.assertEqual(cardclip.look({"grade": "learning"}, "edit"), GRADED["learning"])
        self.assertIsNone(cardclip.look({"grade": "learning"}, "raw"))
        with self.assertRaisesRegex(ValueError, "graded"):
            cardclip.look({}, "graded")


class CommandTests(unittest.TestCase):
    def command(self, clip=CLIP, edl=EDL, backend=NVIDIA, **options):
        return cardclip.command(clip, edl, MEZZ, Path("out.mp4"), {}, backend, **options)

    def test_frames_by_decode_index_restamped_on_the_overlay_grid_then_graded(self):
        graph = graph_of(self.command())
        self.assertIn("select='between(n,30,59)+between(n,100,119)'", graph)
        self.assertIn("settb=1001/30000,setpts=N", graph)
        self.assertIn(GRADED["learning"], graph)
        self.assertNotIn("overlay", graph, "no punched run, no punch branch")
        self.assertLess(graph.index(GRADED["learning"]), graph.index(BT709_TV))

    def test_the_backends_decoder_and_encoder_with_seekable_keyframes_and_the_exact_frame_count(self):
        args = self.command()
        self.assertEqual(args[0], ffio.ffmpeg_bin())
        self.assertIn("-hwaccel", args)
        self.assertIn("h264_nvenc", args)
        self.assertEqual(args[args.index("-g") + 1], "30")
        self.assertEqual(args[args.index("-bf") + 1], "0")
        self.assertEqual(args[args.index("-frames:v") + 1], "50")
        self.assertIn("-an", args)
        cpu = self.command(backend=CPU)
        self.assertIn("libx264", cpu)
        self.assertNotIn("h264_nvenc", cpu)
        self.assertNotIn("-hwaccel", cpu)

    def test_raw_is_ungraded_and_a_punched_run_is_cropped_like_the_master(self):
        clip = {**CLIP, "grade": "raw", "ranges": [[30, 60, False], [100, 120, True]]}
        graph = graph_of(self.command(clip))
        self.assertNotIn("curves", graph)
        self.assertNotIn("eq=", graph)
        # The master's punch window (1000x1778 at 40, 55 on 1080x1920; ffmpeg crops 4:2:0 at 54) straight to the card.
        self.assertIn("crop=1000:1778:40:54,scale=1080:1920:flags=lanczos", graph)
        self.assertIn("crop=1080:1920:0:0,scale=1080:1920:flags=lanczos", graph)
        self.assertIn("overlay=enable='between(n,30,49)'", graph)

    def test_a_seeked_clip_counts_its_frames_from_the_seek(self):
        times = [index * 1001 / 30000 for index in range(400)]
        args = self.command({**CLIP, "ranges": [[100, 150, False]], "frames": 50}, times=times)
        self.assertLess(args.index("-ss"), args.index("-i"))
        self.assertAlmostEqual(float(args[args.index("-ss") + 1]), (times[99] + times[100]) / 2, places=5)
        self.assertIn("select='between(n,0,49)'", graph_of(args))


class CropTests(unittest.TestCase):
    def command(self, clip, spec=None):
        return cardclip.command(clip, EDL, SOURCE_4K, Path("out.mp4"), spec or {}, NVIDIA, frame_size=(2160, 3840))

    def test_a_cropped_card_is_cut_from_the_4k_source_and_never_scales_the_whole_frame(self):
        clip = {**CLIP, "ranges": [[2077, 2149, False]], "frames": 72, "crop": [296, 916, 156, 208]}
        args = self.command(clip)
        graph = graph_of(args)
        self.assertEqual(args[args.index("-i") + 1], str(SOURCE_4K.resolve()))
        self.assertIn("crop=312:416:592:1832,scale=1080:1440:flags=lanczos", graph, "the 1080-grid crop doubled on the 2160 source")
        self.assertNotIn("scale=2160:3840", graph)
        self.assertLess(graph.index("crop=312"), graph.index(GRADED["learning"]))

    def test_a_punched_run_of_a_cropped_card_crops_its_rect_inside_the_punch_window(self):
        clip = {**CLIP, "ranges": [[2077, 2100, False], [2100, 2149, True]], "frames": 72, "crop": [296, 916, 156, 208]}
        even = lambda value: round(value / 2) * 2  # noqa: E731
        down = lambda value: int(value) // 2 * 2  # noqa: E731
        # The punch window on 2160x3840 is 2000x3556 at (80, 110); the card's rect 592, 1832, 312, 416 maps into it.
        x, y, w, h = (down(80 + 592 * 2000 / 2160), down(110 + 1832 * 3556 / 3840), even(312 * 2000 / 2160), even(416 * 3556 / 3840))
        self.assertIn(f"crop={w}:{h}:{x}:{y},scale=1080:1440:flags=lanczos", graph_of(self.command(clip)))

    def test_a_cropped_card_blurs_in_crop_space_and_a_box_outside_it_drops(self):
        clip = {**CLIP, "ranges": [[30, 60, False]], "frames": 30, "crop": [296, 916, 156, 208]}
        graph = graph_of(self.command(clip, {"blur": [[0.0, 5.0, 250, 900, 200, 200, "a face"]]}))
        self.assertIn("gblur", graph)
        self.assertIn("scale=1080:1440:flags=bilinear", graph, "the veil at the card's size")
        self.assertNotIn("gblur", " ".join(self.command(clip, {"blur": [[0.0, 5.0, 0, 0, 500, 500, "a screen"]]})))

    def test_a_blur_box_maps_into_the_cards_output(self):
        mapped = cardclip.crop_regions([(500, 1800, 400, 400, [(0, 10)])], (592, 1832, 312, 416), (1080, 1440))
        self.assertEqual(mapped, [(0, 0, 1066, 1274, [(0, 10)])])
        self.assertEqual(cardclip.crop_regions([(0, 0, 100, 100, [(0, 10)])], (592, 1832, 312, 416), (1080, 1440)), [])


class BlurTests(unittest.TestCase):
    """A card clip composites over the master's blur veil, so it must hide what the master hides, on the same frames."""

    def regions(self, *spans):
        spec = {"blur": [[seconds(start), seconds(end), 100, 200, 300, 400, "screen"] for start, end in spans]}
        return cardclip.clip_regions(CLIP, EDL, spec)

    def master(self, *spans):
        """The master's blurred edited frames, seen through the clip's window (edited 30-80) on clip frames."""
        spec = {"blur": [[seconds(start), seconds(end), 100, 200, 300, 400, "screen"] for start, end in spans]}
        return [[(max(a, 30) - 30, min(b, 80) - 30) for a, b in ranges if a < 80 and b > 30] for *_, ranges in blur.blur_regions(spec, EDL, OUTPUT)]

    def test_a_span_partly_inside_the_clip_blurs_only_its_part_across_the_cut(self):
        (*box, ranges), = self.regions((50, 110))
        self.assertEqual((box, ranges), ([100, 200, 300, 400], [(20, 40)]))
        self.assertEqual([ranges], self.master((50, 110)))

    def test_spans_outside_the_clip_blur_nothing(self):
        self.assertEqual([ranges for *_, ranges in self.regions((35, 45))], [[(5, 15)]])
        for span in ((150, 180), (65, 95), (0, 10)):
            self.assertEqual(self.regions(span), [], span)

    def test_each_branch_blurs_its_own_crop_before_the_punch_overlay(self):
        clip = {**CLIP, "ranges": [[30, 60, False], [100, 120, True]]}
        spec = {"blur": [[seconds(105), seconds(115), 100, 200, 300, 400, "screen"]]}
        graph = graph_of(cardclip.command(clip, EDL, MEZZ, Path("out.mp4"), spec, NVIDIA))
        self.assertIn("between(n,35,44)", graph)
        self.assertEqual(graph.count("gblur"), 2, "one veil per branch")
        self.assertEqual(graph.count("[wide_veil]"), 2, "the branches' labels stay apart")
        self.assertLess(graph.rindex("gblur"), graph.index("overlay=enable='between(n,30,49)'"))


class BystanderTests(unittest.TestCase):
    """A card plays the source outside the edit's own frames, so it carries its own bystander mask (#44): a colleague's
    face showed unblurred in a card on the OnePuhunan edit (Phase 6, 5:02)."""

    def test_a_card_with_a_face_mask_frosts_before_its_crops(self):
        args = cardclip.command(CLIP, EDL, MEZZ, Path("out.mp4"), {}, NVIDIA, faces=Path("cardclips/cc.faces.mkv"))
        graph = graph_of(args)
        self.assertIn("cc.faces.mkv", " ".join(args))
        self.assertIn("[1:v]", graph)
        self.assertLess(graph.index("maskedmerge"), graph.index("crop="))

    def test_a_card_without_one_has_no_second_input(self):
        args = cardclip.command(CLIP, EDL, MEZZ, Path("out.mp4"), {}, NVIDIA)
        self.assertNotIn("[1:v]", graph_of(args))

    def test_the_card_mask_covers_exactly_the_cards_source_frames_in_order(self):
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(cardclip.matte, "encode") as encode:
            cardclip.write_card_mask(CLIP, [], set(), Path(folder) / "m.mkv")
        masks, count, out = encode.call_args.args
        self.assertEqual((count, out.name), (50, "m.mkv"))
        self.assertEqual(len(list(masks)), 50)

    def test_a_clip_blurred_under_another_mask_is_encoded_again(self):
        # OnePuhunan: cards encoded under the 30..218 mask were kept after the fix, so their colleagues stayed see-through.
        with tempfile.TemporaryDirectory() as folder:
            mask = Path(folder) / "cc.faces.mkv"
            samples = [{"t": 1.0, "faces": [{"box": [200, 900, 60, 60], "track": 1}]}]
            with mock.patch.object(cardclip.matte, "encode", side_effect=lambda masks, count, out: out.write_bytes(b"mask")) as encode:
                cardclip.write_card_mask(CLIP, samples, set(), mask)
                drawn = cardclip.clip_record(CLIP, EDL, {}, mask)
                cardclip.write_card_mask(CLIP, samples, set(), mask)
                self.assertEqual(encode.call_count, 1)  # an unchanged card mask is not drawn again
                self.assertEqual(cardclip.clip_record(CLIP, EDL, {}, mask), drawn)
                with mock.patch.object(cardclip.face_mask, "MASK_FORMAT", cardclip.face_mask.MASK_FORMAT + 1):
                    cardclip.write_card_mask(CLIP, samples, set(), mask)
                self.assertNotEqual(cardclip.clip_record(CLIP, EDL, {}, mask), drawn)
            self.assertNotEqual(drawn, json.dumps({"boxes": [], "crop": None, "faces": True}))  # a pre-fix record never matches


class LetterboxCardTests(unittest.TestCase):
    BAND = [0, 420, 1080, 1080]  # a square picture letterboxed on the 1080 grid

    def test_an_uncropped_card_on_letterboxed_footage_frames_a_9_16_window_on_the_face(self):
        x, y, w, h = cardclip.framed_crop(self.BAND, [700, 900, 60, 60])
        self.assertEqual((y, h), (420, 1080))
        self.assertEqual(w, 608)
        self.assertTrue(x <= 730 <= x + w and x + w <= 1080 and x % 2 == 0)

    def test_without_a_face_it_frames_the_middle_of_the_picture(self):
        self.assertEqual(cardclip.framed_crop(self.BAND, None), [236, 420, 608, 1080])


class PrepareTests(unittest.TestCase):
    FOUND = {"samples": [{"t": 1.0, "faces": [{"box": [700, 900, 60, 60], "track": 0}, {"box": [200, 900, 60, 60], "track": 1}]}], "creator": [0]}

    def prepare(self, clip=CLIP, band=(0, 420, 1080, 1080), found=FOUND):
        with mock.patch.object(cardclip.faces, "recorded_band", return_value=list(band)), \
                mock.patch.object(cardclip, "write_card_mask") as write:
            return cardclip.prepare(clip, "v1", found), write

    def test_a_letterboxed_uncropped_card_is_framed_on_the_creator_and_masked(self):
        (clip, mask), write = self.prepare()
        self.assertEqual(clip["crop"][2:], [608, 1080])
        self.assertTrue(clip["crop"][0] <= 730 <= clip["crop"][0] + 608)
        self.assertEqual(mask.name, "cc-footageCard-0123456789.faces.mkv")
        write.assert_called_once()

    def test_a_card_that_fills_9_16_and_no_blur_is_left_alone(self):
        (clip, mask), write = self.prepare(band=(0, 0, 1080, 1920), found=None)
        self.assertEqual((clip, mask), (CLIP, None))
        write.assert_not_called()

    def test_a_card_with_its_own_crop_keeps_it(self):
        cropped = {**CLIP, "crop": [0, 500, 540, 960]}
        (clip, _), _ = self.prepare(clip=cropped)
        self.assertEqual(clip["crop"], [0, 500, 540, 960])


class StaleClipTests(unittest.TestCase):
    """Two cue lists of one video keep their own clips: encoding one never removes the other's."""

    def test_only_the_clips_this_cue_list_dropped_are_removed(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            for name in ("cc-a.mp4", "cc-b.mp4", "cc-shared.mp4", "cc-old.mp4"):
                (folder / name).write_bytes(b"")
            cardclip.prune(folder, "cc", {folder / "cc-a.mp4", folder / "cc-shared.mp4", folder / "cc-old.mp4"})
            cardclip.prune(folder, "cc:cc+x", {folder / "cc-b.mp4", folder / "cc-shared.mp4"})
            cardclip.prune(folder, "cc", {folder / "cc-a.mp4"})
            self.assertEqual(sorted(path.name for path in folder.glob("*.mp4")), ["cc-a.mp4", "cc-b.mp4", "cc-shared.mp4"])
            cardclip.prune(folder, "cc:cc+x", set())
            self.assertEqual(sorted(path.name for path in folder.glob("*.mp4")), ["cc-a.mp4"])

    def test_a_dropped_clip_takes_its_bystander_mask_and_key_with_it(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            for name in ("cc-old.mp4", "cc-old.faces.mkv", "cc-old.faces.key"):
                (folder / name).write_bytes(b"")
            cardclip.prune(folder, "cc", {folder / "cc-old.mp4"})
            cardclip.prune(folder, "cc", set())
            self.assertEqual(sorted(path.name for path in folder.glob("cc-*")), [])


class RefusalTests(unittest.TestCase):
    def test_a_short_clip_is_refused_naming_both_counts(self):
        with self.assertRaisesRegex(RuntimeError, "49.*50"):
            cardclip.assert_frames(Path("x.mp4"), 49, 50)
        cardclip.assert_frames(Path("x.mp4"), 50, 50)

    def test_a_cropped_card_without_the_4k_source_is_refused(self):
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(cardclip, "WORK", Path(folder)):
            with self.assertRaisesRegex(FileNotFoundError, "sources"):
                cardclip.source_of({**CLIP, "crop": [0, 0, 100, 100]}, "v1", MEZZ)
            self.assertEqual(cardclip.source_of(CLIP, "v1", MEZZ), (MEZZ, OUTPUT))

    def test_the_manifest_builds_with_the_project_style_so_a_learning_sheet_is_drawn(self):
        built = subprocess.CompletedProcess([], 1, "", "stop")
        with mock.patch.object(cardclip.subprocess, "run", return_value=built) as run, self.assertRaises(RuntimeError):
            cardclip.manifest("v1", ["--style", "work/style.json"])
        self.assertEqual(run.call_args.args[0][-3:], ["--clips", "--style", "work/style.json"])

    def test_a_failed_manifest_build_names_build_js(self):
        failed = subprocess.CompletedProcess([], 1, "", "footageCard at 2s overlaps an animated zoom (push, frames 60-90)")
        with mock.patch.object(cardclip.subprocess, "run", return_value=failed), self.assertRaisesRegex(RuntimeError, "(?s)--clips.*zoom"):
            cardclip.manifest("v1")


def nvenc_ready():
    if not has_ffmpeg():
        return False
    probe = subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-f", "lavfi", "-i", "color=size=256x256:duration=0.1", "-c:v", "h264_nvenc",
                            "-f", "null", "-"], capture_output=True)
    return probe.returncode == 0


@unittest.skipUnless(nvenc_ready(), "needs an NVENC ffmpeg")
class EncodeTests(unittest.TestCase):
    """A fixture manifest as build.js --clips writes it, encoded on NVENC from a fixture mezz."""

    def test_clips_hold_their_frame_count_and_the_source_frames_they_name(self):
        with tempfile.TemporaryDirectory() as folder:
            work = Path(folder)
            for sub in ("mezz", "cuts", "edl"):
                (work / sub).mkdir()
            (work / "cuts" / "cc.json").write_text("{}", encoding="utf-8")
            (work / "edl" / "cc.json").write_text(json.dumps({**make_edl([(0, 60), (100, 200)], zooms=[1.0, 1.08]), "base": "cc"}), encoding="utf-8")
            mezz = work / "mezz" / "cc.mp4"
            subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-f", "lavfi", "-i", f"testsrc2=size=1080x1920:rate={NTSC['fps_num']}/{NTSC['fps_den']}",
                            "-frames:v", "130", "-c:v", "h264_nvenc", "-g", "30", "-bf", "0", "-pix_fmt", "yuv420p", str(mezz)], check=True)
            data = {"video": "cc", "base": "cc", "clips": [
                {**CLIP, "file": "cardclips/cc-footageCard-0123456789.mp4", "ranges": [[30, 60, False], [100, 120, True]]},
                {"id": "gradeWipe-9876543210", "kind": "gradeWipe", "at": 1.5, "firstFrame": 40, "frames": 30, "grade": "raw",
                 "ranges": [[40, 70, False]], "file": "cardclips/cc-gradeWipe-9876543210.mp4"}]}
            patches = [mock.patch.object(module, "WORK", work) for module in (cardclip, pipeline)]
            patches += [mock.patch.object(cardclip.backends, "active", return_value=NVIDIA), mock.patch("builtins.print")]
            with patches[0], patches[1], patches[2], patches[3] as printed:
                cardclip.encode_clips("cc", data)
                for clip in data["clips"]:
                    self.assertEqual(render_final.count_frames(work / clip["file"]), clip["frames"])

                def frames(path, select):
                    raw = subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-i", str(path), "-vf", f"select='{select}',{BT709_TV},scale=270:480",
                                          "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True, check=True).stdout
                    return np.frombuffer(raw, np.uint8).reshape(-1, 480, 270).astype(float)

                clip = frames(work / data["clips"][1]["file"], "eq(n,0)")[0]
                same, following = frames(mezz, "eq(n,40)+eq(n,41)")
                self.assertLess(np.abs(clip - same).mean(), 2.0, "the raw clip's first frame is its first source frame")
                self.assertGreater(np.abs(clip - following).mean(), np.abs(clip - same).mean())
                printed.reset_mock()
                cardclip.encode_clips("cc", data)
                self.assertEqual(sum("unchanged" in str(call) for call in printed.call_args_list), 2, "a second run keeps both")
                # A blur added to the cut spec re-encodes the clip it falls on, and only that one.
                (work / "cuts" / "cc.json").write_text(json.dumps({"blur": [[0.8, 1.2, 0, 0, 200, 200, "screen"]]}), encoding="utf-8")
                printed.reset_mock()
                cardclip.encode_clips("cc", data)
                self.assertEqual(sum("unchanged" in str(call) for call in printed.call_args_list), 1)


if __name__ == "__main__":
    unittest.main()
