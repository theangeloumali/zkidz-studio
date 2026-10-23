# Created by The Angelo Umali.
# The §7.6 gates run inside the render path, not only as functions: a bad graph, an unbounded looping still, a count
# mismatch, an off-target loudness, a bad caption group or a spec edited mid-render each stop the step before its output lands.
import json
import shutil
import tempfile
import unittest
import wave
from pathlib import Path
from unittest import mock

from support import HF, make_edl  # first: it sets a scratch ZKS_HOME

from zks_engine import audio, backends, captions, join_sources, render_final, showcase
from zks_engine.specs import gates
from zks_engine.specs.gates import GateFailed

CPU = backends.get("cpu")
BAD_GRAPH = ["ffmpeg", "-i", "clip.mp4", "-vf", "select=eq(n\\,3),setpts=N*1001", "out.mp4"]
UNBOUNDED_STILL = ["ffmpeg", "-loop", "1", "-framerate", "30", "-i", "veil.png", "out.mp4"]


def scratch_dir(test):
    folder = tempfile.TemporaryDirectory()
    test.addCleanup(folder.cleanup)
    return Path(folder.name)


def write_wav(path, samples):
    with wave.open(str(path), "wb") as track:
        track.setnchannels(2)
        track.setsampwidth(2)
        track.setframerate(48000)
        track.writeframes(bytes(4 * samples))


class CheckCommandTests(unittest.TestCase):
    def test_every_graph_option_is_linted(self):
        with self.assertRaisesRegex(GateFailed, "setpts"):
            gates.check_command(BAD_GRAPH)
        with self.assertRaisesRegex(GateFailed, "hwupload_cuda"):
            gates.check_command(["ffmpeg", "-i", "a.mp4", "-filter_complex", "[0:v]hwupload_cuda[o];[o][o]overlay_cuda[v]", "out.mp4"])

    def test_an_unbounded_looping_still_fails(self):
        with self.assertRaisesRegex(GateFailed, "bounded"):
            gates.check_command(UNBOUNDED_STILL)

    def test_a_clean_command_passes(self):
        gates.check_command(["ffmpeg", "-i", "a.mp4", "-vf", "settb=1001/30000,setpts=N", "out.mp4"])


class SpawnGateTests(unittest.TestCase):
    def test_a_bad_graph_never_reaches_a_piece_encode(self):
        with mock.patch.object(join_sources.subprocess, "run") as run, self.assertRaisesRegex(GateFailed, "setpts"):
            join_sources.run_all([BAD_GRAPH], 2)
        run.assert_not_called()

    def test_a_bad_graph_aborts_the_master_before_ffmpeg_runs(self):
        root = scratch_dir(self)
        route = render_final.Route(CPU, False, "", (1080, 1920))
        edl = make_edl([(0, 30)])
        with (mock.patch.object(render_final, "chunk_command", return_value=BAD_GRAPH),
              mock.patch.object(render_final.subprocess, "Popen") as popen, mock.patch("builtins.print"),
              self.assertRaisesRegex(GateFailed, "setpts")):
            render_final.render_chunks(edl, {}, root / "clip.mp4", route, (1080, 1920), [], root / "frames", root / "a.wav", root / "v1.part.mp4")
        popen.assert_not_called()

    def test_a_png_showcase_insert_is_a_bounded_looping_input(self):
        still = scratch_dir(self) / "media" / "still.png"
        still.parent.mkdir()
        shutil.copyfile(HF / "brand" / "zkidz-dev-logo.png", still)
        insert = {"at": 0.0, "end": 1.0, "src": str(still), "src_at": 0.0}
        with mock.patch.object(showcase, "WORK", still.parent.parent / "work"), \
             mock.patch("zks_engine.pipeline.WORK", still.parent.parent / "work"), \
             mock.patch.object(showcase, "probe_video", return_value={"width": 1080, "height": 1920, "pix_fmt": "rgba"}):
            command = showcase.insert_command(insert, 0, 30, Path("out.mp4"), CPU, (30000, 1001))
        gates.check_command(command)
        self.assertEqual(command[command.index("-t") + 1], "1.001000")


class RenderMasterGateTests(unittest.TestCase):
    """render_final.main with its probes and the encode stubbed: only the gates around them run for real."""

    def setUp(self):
        self.work = scratch_dir(self) / "work"
        for sub in ("cuts", "edl", "frames/v1", "audio"):
            (self.work / sub).mkdir(parents=True)
        self.edl = make_edl([(0, 30)])
        (self.work / "edl" / "v1.json").write_text(json.dumps(self.edl), encoding="utf-8")
        (self.work / "cuts" / "v1.json").write_text(json.dumps({"source": "media/clip.mp4"}), encoding="utf-8")
        for index in range(30):
            (self.work / "frames" / "v1" / f"{index:05d}.png").write_bytes(b"")
        self.track = self.work / "audio" / "v1_edit.wav"
        write_wav(self.track, 48048)
        for name, value in (("WORK", self.work), ("check_overlay_frames", None), ("intro_of", None), ("source_path", Path("clip.mp4")),
                            ("route_for", render_final.Route(CPU, False, "", (1080, 1920))), ("assert_upright", None)):
            patcher = mock.patch.object(render_final, name, value if name == "WORK" else mock.Mock(return_value=value))
            patcher.start()
            self.addCleanup(patcher.stop)
        for patcher in (mock.patch("zks_engine.pipeline.WORK", self.work), mock.patch("builtins.print")):
            patcher.start()
            self.addCleanup(patcher.stop)

    def render(self, encode=lambda *args, **kwargs: args[9].write_bytes(b"master")):
        with mock.patch.object(render_final, "encode_master", side_effect=encode):
            render_final.main("v1")

    def test_a_clean_edit_renders(self):
        self.render()
        self.assertTrue((self.work / "out" / "v1.mp4").exists())

    def test_an_audio_count_mismatch_stops_the_render(self):
        write_wav(self.track, 48000)
        with self.assertRaisesRegex(GateFailed, "audio has 48000 samples"):
            self.render()

    def test_a_spec_edited_mid_render_never_becomes_the_master(self):
        def encode(*args, **kwargs):
            args[9].write_bytes(b"master")
            (self.work / "cuts" / "v1.json").write_text(json.dumps({"source": "media/other.mp4"}), encoding="utf-8")

        with self.assertRaisesRegex(GateFailed, "changed after the render snapshot"):
            self.render(encode)
        self.assertFalse((self.work / "out" / "v1.mp4").exists())


class LoudnessGateTests(unittest.TestCase):
    def test_an_edit_off_the_loudness_target_fails(self):
        work = scratch_dir(self)
        (work / "audio").mkdir()
        edl = {**make_edl([(0, 30)]), "bleeps": []}
        with (mock.patch.object(audio, "WORK", work), mock.patch.object(audio, "load_edl", return_value=edl),
              mock.patch.object(audio, "load_cuts", return_value={}), mock.patch.object(audio, "read_source", return_value=None),
              mock.patch.object(audio, "assemble", return_value=__import__("numpy").zeros((48048, 2))),
              mock.patch.object(audio, "loudnorm", return_value={"input_i": "-30"}), mock.patch.object(audio, "loudness", return_value=(-20.0, -3.0)),
              mock.patch("builtins.print"), self.assertRaisesRegex(GateFailed, "-20.0 LUFS")):
            audio.main("v1")


class CaptionGateWiringTests(unittest.TestCase):
    def emit(self, phrases, entries):
        work = scratch_dir(self)
        for sub in ("captions", "cues"):
            (work / sub).mkdir()
        (work / "captions" / "v1.phrases.json").write_text(json.dumps(phrases), encoding="utf-8")
        (work / "captions" / "v1.json").write_text(json.dumps(entries), encoding="utf-8")
        with mock.patch.object(captions, "WORK", work), mock.patch("builtins.print"):
            captions.emit_cues("v1")

    def test_a_group_spanning_two_reel_keeps_fails_the_gate(self):
        phrases = [{"id": 0, "at": 0, "end": 1, "reel": 0, "tl": "a"}, {"id": 1, "at": 1, "end": 2, "reel": 1, "tl": "b"}]
        with self.assertRaisesRegex(SystemExit, r"cross a Reels keep edge"):
            self.emit(phrases, [{"ids": [0, 1], "en": "a b"}])

    def test_gate_wrap_uses_the_plates_font_metrics(self):
        # 61 narrow characters fit two lines of the plate; a flat 60-character cap would reject them.
        gates.check_captions([{"ids": [0], "en": "lit " * 15 + "i"}], [{"id": 0, "reel": None}])
        with self.assertRaisesRegex(GateFailed, "wrap to 3 lines"):
            gates.check_captions([{"ids": [0], "en": "MMMM " * 12}], [{"id": 0, "reel": None}])


if __name__ == "__main__":
    unittest.main()
