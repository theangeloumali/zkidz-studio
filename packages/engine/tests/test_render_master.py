# Created by The Angelo Umali.
# render_master: the quality plan per backend, the step order, and real CPU and NVIDIA masters checked against the EDL and loudness.
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from support import has_ffmpeg, make_edl  # first: it sets a scratch ZKS_HOME

from zks_engine import backends, cli, ffio, qc, render, render_final
from zks_engine.pipeline import frame_to_sample
from zks_engine.specs.gates import GateFailed

FPS = "30000/1001"
EDL = make_edl([(0, 60), (90, 150)])


def run(command, **options):
    subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-nostdin", "-y", *command], check=True, timeout=180, **options)


def scratch_project(test):
    """A project folder in the layout render_final reads: media/, work/{cuts,edl,audio,frames}; removed when `test` ends."""
    root = Path(tempfile.mkdtemp(prefix="zks-render-"))
    test.addCleanup(shutil.rmtree, root, ignore_errors=True)
    work = root / "work"
    for sub in ("cuts", "edl", "audio", "frames/v1"):
        (work / sub).mkdir(parents=True)
    (root / "media").mkdir()
    return root, work


def build_inputs(root, work, loudness_target=-14, edl=EDL, seconds=6):
    """A moving source with a noise track, the edit's audio at the target loudness, and one clear overlay PNG per frame."""
    source = root / "media" / "source.mkv"
    run(["-f", "lavfi", "-i", f"testsrc2=size=540x960:rate={FPS}", "-f", "lavfi", "-i", "anoisesrc=seed=2:amplitude=0.2:sample_rate=48000",
         "-t", str(seconds), "-c:v", "libx264", "-preset", "ultrafast", "-g", "10", "-c:a", "pcm_s16le", str(source)])
    (work / "cuts" / "v1.json").write_text(json.dumps({"source": "media/source.mkv", "remove": [], "duration": seconds}), encoding="utf-8")
    (work / "edl" / "v1.json").write_text(json.dumps(edl), encoding="utf-8")
    samples = frame_to_sample(edl["frames"], edl)
    run(["-f", "lavfi", "-t", str(seconds - 1), "-i", "anoisesrc=seed=3:amplitude=0.2:sample_rate=48000",
         "-af", f"loudnorm=I={loudness_target}:TP=-2:LRA=7,aresample=48000,atrim=end_sample={samples}", "-ac", "2", "-c:a", "pcm_s16le",
         str(work / "audio" / "v1_edit.wav")])
    clear = work / "frames" / "clear.png"
    run(["-f", "rawvideo", "-pix_fmt", "rgba", "-s", "1080x1920", "-i", "-", "-frames:v", "1", str(clear)], input=bytes(1080 * 1920 * 4))
    for frame in range(edl["frames"]):
        shutil.copyfile(clear, work / "frames" / "v1" / f"{frame:05d}.png")


class Backend:
    def __init__(self, name):
        self.name = name


class MasterPlanTests(unittest.TestCase):
    def test_4k_is_hevc_uhd_on_nvidia_and_a_1080_master_on_cpu(self):
        self.assertEqual(render.master_flags("nvidia", "4k"), (False, True))
        self.assertEqual(render.master_flags("cpu", "4k"), (False, False))

    def test_draft_and_final_are_1080_everywhere(self):
        self.assertEqual(render.master_flags("nvidia", "draft"), (True, False))
        self.assertEqual(render.master_flags("cpu", "final"), (False, False))

    def test_master_names_follow_render_final(self):
        work = Path("work")
        self.assertEqual(render.master_path(work, "v1", draft=False, uhd=True), work / "out" / "v1-4k.mp4")
        self.assertEqual(render.master_path(work, "v1", draft=True, uhd=False), work / "out" / "v1-draft.mp4")

    def test_overlays_draw_the_main_sheet_a_reels_overrides_and_the_captions(self):
        work = Path(tempfile.mkdtemp())
        for sub in ("edl", "cues"):
            (work / sub).mkdir()
        (work / "edl" / "v1.json").write_text(json.dumps({**EDL, "base": "v1"}), encoding="utf-8")
        (work / "edl" / "v1r.json").write_text(json.dumps({**EDL, "base": "v1"}), encoding="utf-8")
        for sheet in ("v1", "v1-cc"):
            (work / "cues" / f"{sheet}.json").write_text("[]", encoding="utf-8")
        self.assertEqual(render.cue_sheet_names("v1", work), ["v1", "v1-cc"])
        self.assertEqual(render.cue_sheet_names("v1r", work), ["v1", "v1-cc"])
        (work / "cues" / "v1r.json").write_text("[]", encoding="utf-8")
        self.assertEqual(render.cue_sheet_names("v1r", work), ["v1", "v1r", "v1-cc"])

    def test_the_edit_stage_then_overlays_and_sfx_run_before_the_encode(self):
        calls = []
        with self.assertRaises(FileNotFoundError):  # no master is written by the stand-in encode
            render.render_master("v1", "4k", "media/source.mkv", Backend("nvidia"), edit=lambda video, source: calls.append(("edit", video, source)),
                                 preflight=lambda video: calls.append(("preflight", video)), overlays=lambda video: calls.append(("overlays", video)),
                                 encode=lambda video, draft, uhd: calls.append(("encode", video, draft, uhd)), work=Path(tempfile.mkdtemp()))
        self.assertEqual(calls, [("edit", "v1", "media/source.mkv"), ("preflight", "v1"), ("overlays", "v1"), ("encode", "v1", False, True)])

    def test_a_refused_route_stops_before_the_overlay_frames(self):
        calls = []

        def refuse(video):
            sys.exit(f"{video}: refused")

        with self.assertRaises(SystemExit):
            render.render_master("v1", "4k", "media/source.mkv", Backend("nvidia"), edit=lambda video, source: None, preflight=refuse,
                                 overlays=lambda video: calls.append("overlays"), encode=lambda video, draft, uhd: calls.append("encode"))
        self.assertEqual(calls, [])


class PreflightTests(unittest.TestCase):
    def preflight(self, edl, on_gpu):
        route = render_final.Route(Backend("nvidia"), on_gpu, "", (2160, 3840))
        with mock.patch.object(render_final, "load_edl", return_value=edl), mock.patch.object(render_final, "load_cuts", return_value={}), \
                mock.patch.object(render_final, "source_path", return_value=Path("s.mkv")), \
                mock.patch.object(render_final, "route_for", return_value=route) as route_for:
            render_final.preflight("v1")
        return route_for

    def test_zooms_off_the_gpu_composite_are_refused_up_front(self):
        with self.assertRaisesRegex(SystemExit, "animated zooms"):
            self.preflight({"zooms": [{"start": 0, "end": 30, "preset": "snap"}]}, on_gpu=False)

    def test_zooms_on_the_gpu_composite_pass(self):
        self.preflight({"zooms": [{"start": 0, "end": 30, "preset": "snap"}]}, on_gpu=True)

    def test_an_edl_without_zooms_or_matte_never_probes_the_route(self):
        self.preflight({"zooms": [], "matte": []}, on_gpu=False).assert_not_called()


class CliTests(unittest.TestCase):
    def test_the_phase_5_commands_parse_with_json_only(self):
        args = cli.parser().parse_args(["render-master", "--video", "v1", "--quality", "4k", "--source", "s.mkv", "--json"])
        self.assertEqual((args.video, args.quality), ("v1", "4k"))
        with self.assertRaises(SystemExit):
            cli.parser().parse_args(["render-master", "--video", "v1", "--quality", "8k", "--source", "s.mkv", "--json"])

    def test_motion_regions_parse_as_boxes(self):
        args = cli.parser().parse_args(["check-motion", "--video", "v1", "--stage", "master", "--source", "s.mkv", "--region", "240,880,600,380",
                                        "--region", "0,0,1080,400", "--json"])
        self.assertEqual(args.region, [(240, 880, 600, 380), (0, 0, 1080, 400)])

    def test_make_covers_writes_the_post_caption_beside_the_covers(self):
        made = [{"path": "covers/v1r-cover-a.png", "at": 2.3, "blurBoxes": 0}]
        with mock.patch("zks_engine.covers.make_covers", return_value=made) as make, \
                mock.patch("zks_engine.covers.write_post_caption", return_value="covers/v1-caption.txt") as write, \
                mock.patch("zks_engine.render.commands.snapshot_input", side_effect=Path), mock.patch("builtins.print") as printed:
            code = cli.main(["make-covers", "--video", "v1r", "--at", "2.3", "--post-caption", "post.txt", "--json"])
        self.assertEqual(code, 0)
        make.assert_called_once_with("v1r", [2.3], None)
        write.assert_called_once_with("v1r", Path("post.txt"))
        self.assertEqual(json.loads(printed.call_args.args[0]), {"covers": made, "postCaption": "covers/v1-caption.txt"})

    def test_export_status_reports_the_master_qc_passed(self):
        verdict = {"master": {"relPath": "out/v1-4k.mp4", "size": 12, "mtimeNs": "1700000000123456789", "sha256": "0" * 64},
                   "source": {"relPath": "sources/v1.mkv"}, "specsSnapshot": "snapshots/abc"}
        with mock.patch("zks_engine.qc.assert_exportable", return_value=verdict), mock.patch("builtins.print") as printed:
            self.assertEqual(cli.main(["qc-status", "--video", "v1", "--json"]), 0)
        self.assertEqual(json.loads(printed.call_args.args[0]), {"ok": True, **verdict})

    def test_export_status_without_a_report_is_a_gate_failure(self):
        with mock.patch("zks_engine.qc.inputs.WORK", Path(tempfile.mkdtemp())), mock.patch("builtins.print") as printed:
            self.assertEqual(cli.main(["qc-status", "--video", "v1", "--json"]), cli.EXIT_GATE_FAILED)
        self.assertEqual(json.loads(printed.call_args.args[0])["error"]["code"], "gate_failed")


@unittest.skipUnless(has_ffmpeg(), "needs ffmpeg")
class CpuMasterTests(unittest.TestCase):
    def render(self, loudness_target=-14):
        root, work = scratch_project(self)
        build_inputs(root, work, loudness_target)
        with mock.patch("zks_engine.pipeline.WORK", work), mock.patch("zks_engine.render_final.WORK", work), \
                mock.patch.dict(os.environ, {"ZKS_BACKEND": "cpu", "RENDER_JOBS": "1"}):
            # build_inputs writes the EDL and the edit audio the edit stage would.
            return render.render_master("v1", "4k", "media/source.mkv", edit=lambda video, source: None, overlays=lambda video: None, work=work)

    def test_a_cpu_master_matches_the_edl_frames_and_loudness(self):
        report = self.render()
        self.assertEqual(report["path"], "out/v1.mp4")
        self.assertEqual(report["frames"], EDL["frames"])
        self.assertLessEqual(abs(report["lufs"] + 14), 1)
        self.assertLessEqual(report["truePeak"], -1)
        self.assertGreater(report["bytes"], 0)

    def test_the_render_reports_the_masters_hash_and_every_input_qc_will_read(self):
        report = self.render()
        self.assertEqual(report["master"]["relPath"], report["path"])
        self.assertEqual((report["master"]["size"], len(report["master"]["sha256"])), (report["bytes"], 64))
        self.assertIn("edl/v1.json", report["inputs"])
        self.assertTrue(all(len(digest) == 64 for digest in report["inputs"].values()), report["inputs"])

    def test_a_quiet_master_fails_the_loudness_gate(self):
        with self.assertRaisesRegex(GateFailed, "LUFS"):
            self.render(loudness_target=-20)


def nvidia_passes_its_probe():
    return has_ffmpeg() and any(attempt["backend"] == "nvidia" and attempt["ok"] for attempt in backends.probe_attempts())


# Plan Phase 5 AC: a 60 s edit renders to 4K HEVC on nvidia with frames = EDL, -14 +/-1 LUFS and the motion gate passing.
@unittest.skipUnless(nvidia_passes_its_probe(), "needs an NVIDIA GPU that passes the encode probe")
class NvidiaMasterTests(unittest.TestCase):
    def test_a_60_s_edit_renders_a_4k_hevc_master_that_matches_the_edl_and_moves(self):
        edl = make_edl([(0, 900), (930, 1830)])
        root, work = scratch_project(self)
        build_inputs(root, work, edl=edl, seconds=62)
        with mock.patch("zks_engine.pipeline.WORK", work), mock.patch("zks_engine.render_final.WORK", work), \
                mock.patch("zks_engine.qc.inputs.WORK", work), mock.patch.dict(os.environ, {"ZKS_BACKEND": "nvidia"}):
            report = render.render_master("v1", "4k", "media/source.mkv", edit=lambda video, source: None, overlays=lambda video: None, work=work)
            master = work / report["path"]
            motion = qc.check_motion_master("v1", master, root / "media" / "source.mkv")
        stream = subprocess.run([ffio.ffprobe_bin(), "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height",
                                 "-of", "csv=p=0", str(master)], capture_output=True, text=True, check=True).stdout.strip()
        self.assertEqual(stream, "hevc,2160,3840")
        self.assertEqual(report["frames"], edl["frames"])
        self.assertLessEqual(abs(report["lufs"] + 14), 1)
        self.assertEqual(motion["verdict"], "PASS", motion)
        self.assertEqual(len(motion["shots"]), 2)


if __name__ == "__main__":
    unittest.main()
