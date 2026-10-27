# Created by The Angelo Umali.
# zks-engine caption-phrases / render-preview: the phrase file captions are written against, and stills of the edit.
import json
import subprocess
import unittest
from unittest import mock

from support import make_edl  # first: it sets a scratch ZKS_HOME

from test_cli_inspect import ScratchWork, call_cli, write_wav
from zks_engine import captions, cli, render
from zks_engine.render import commands as render_commands

WORDS = [{"at": 1.0, "end": 1.4, "text": " kumusta "}, {"at": 1.5, "end": 1.9, "text": "po"}, {"at": 3.0, "end": 3.4, "text": "salamat"}]


class CaptionPhrasesTests(ScratchWork):
    def setUp(self):
        super().setUp()
        write_wav(self.work / "audio" / "v1.wav", (0.9, 3.0, 2.1))
        self.write_cuts([])

    def write_cuts(self, removals):
        spec = {"schemaVersion": 1, "sourceAssetId": "00000000-0000-4000-8000-0000000a0002", "durationS": 6, "fps": {"num": 30000, "den": 1001},
                "removals": removals}
        (self.work / "cuts" / "v1.json").write_text(json.dumps(spec), encoding="utf-8")

    def write_words(self):
        (self.work / "transcripts" / "v1.words.json").write_text(json.dumps(WORDS), encoding="utf-8")

    def write_reel(self, spec):
        (self.work / "reels").mkdir()
        (self.work / "reels" / "v1.json").write_text(json.dumps(spec), encoding="utf-8")

    def test_phrases_carry_text_and_are_written_for_the_cue_step(self):
        self.write_words()
        code, payload = call_cli("caption-phrases", "--json", "--video", "v1")
        self.assertEqual(code, 0, payload)
        self.assertEqual([(phrase["id"], phrase["reel"], phrase["text"]) for phrase in payload["phrases"]],
                         [(0, None, "kumusta po"), (1, None, "salamat")])
        self.assertTrue(all(phrase["at"] < phrase["end"] for phrase in payload["phrases"]))
        written = json.loads((self.work / "captions" / "v1.phrases.json").read_text(encoding="utf-8"))
        self.assertEqual(written, payload["phrases"])

    def test_reel_keeps_in_the_studio_object_shape_tag_each_phrase(self):
        self.write_words()
        self.write_reel({"schemaVersion": 1, "baseVideoId": "v1", "keep": [{"at": 2.5, "end": 4.0, "pin": "top"}]})
        _code, payload = call_cli("caption-phrases", "--json", "--video", "v1", "--reel")
        self.assertEqual([phrase["reel"] for phrase in payload["phrases"]], [None, 0])

    def test_the_films_jsonl_transcript_in_ms_and_list_keeps_still_read(self):
        lines = [json.dumps({"start": word["at"] * 1000, "end": word["end"] * 1000, "text": word["text"]}) for word in WORDS]
        (self.work / "transcripts" / "v1_words.json").write_text("\n".join(lines), encoding="utf-8")
        self.write_reel({"keep": [[2.5, 4.0, "extra"]]})
        with mock.patch("builtins.print"):
            phrases = captions.build_phrases("v1", "reels/v1.json")
        self.assertEqual([(phrase["text"], phrase["reel"]) for phrase in phrases], [("kumusta po", None), ("salamat", 0)])

    # Codex review: phrases read the render's edl/, which a fresh project lacks and a later set_cuts leaves stale.
    def test_phrases_follow_the_current_cut_spec_not_the_last_render(self):
        self.write_words()
        (self.work / "edl" / "v1.json").write_text(json.dumps(make_edl([(0, 170)])), encoding="utf-8")
        self.write_cuts([{"at": 2.5, "end": 4.0, "reason": "cut salamat", "pin": True}])
        _code, payload = call_cli("caption-phrases", "--json", "--video", "v1")
        self.assertEqual([phrase["text"] for phrase in payload["phrases"]], ["kumusta po"])

    def test_refuses_before_the_transcript_or_the_cut_spec_exists(self):
        self.assert_refused("caption-phrases", "--json", "--video", "v1", mentions="transcribe")
        self.write_words()
        (self.work / "cuts" / "v1.json").unlink()
        self.assert_refused("caption-phrases", "--json", "--video", "v1", mentions="set_cuts")

    def test_refuses_a_reel_flag_without_a_reel_spec(self):
        self.write_words()
        self.assert_refused("caption-phrases", "--json", "--video", "v1", "--reel", mentions="reels/v1.json")


class RenderPreviewTests(ScratchWork):
    def setUp(self):
        super().setUp()
        (self.work / "edl" / "v1.json").write_text(json.dumps(make_edl([(0, 300)])), encoding="utf-8")
        (self.work / "cues" / "v1.json").write_text("[]", encoding="utf-8")
        self.edit = self.patch(render_commands.stages, "edit_stage", side_effect=self.build_edit)
        self.drawn = []

    def build_edit(self, video, source, **_options):
        """edit_stage stand-in: writes the preview's own EDL, as the real one does."""
        (self.work / "edl" / f"{video}.json").write_text(json.dumps(make_edl([(0, 300)])), encoding="utf-8")
        return {"frames": 300}

    def draw(self, *names):
        """render.js stand-in: records its argv and writes the named stills."""
        def run(argv, **_options):
            self.drawn.append(argv)
            folder = self.work / "stills" / "v1.hf"
            folder.mkdir(parents=True, exist_ok=True)
            for name in names:
                (folder / f"t{name}.png").write_bytes(b"png")
            return subprocess.CompletedProcess(argv, 0, stderr="")
        self.patch(render.subprocess, "run", side_effect=run)

    def preview(self, *args):
        return call_cli("render-preview", "--json", "--video", "v1", "--source", "media/s.mkv", *args)

    # Codex review: the preview's edit stage rewrote the render's EDL and edit audio, so QC refused the master already made.
    def test_the_renders_edit_files_come_back_untouched_after_a_preview_even_a_failed_one(self):
        render_edl, render_audio = self.work / "edl" / "v1.json", self.work / "audio" / "v1_edit.wav"
        render_audio.write_bytes(b"render audio")
        before = render_edl.read_bytes()
        preview_edl = json.dumps(make_edl([(0, 100)]))
        seen = []

        def preview_edit(video, source, **_options):
            self.assertFalse(render_edl.exists())  # set aside before the preview's edit stage runs
            render_edl.write_text(preview_edl, encoding="utf-8")
            render_audio.write_bytes(b"preview audio")
            (self.work / "edl" / "v1.csv").write_text("preview csv", encoding="utf-8")

        def draw(argv, **_options):
            seen.append(render_edl.read_text(encoding="utf-8"))
            return subprocess.CompletedProcess(argv, 1, stderr="render.js failed")

        self.edit.side_effect = preview_edit
        self.patch(render.subprocess, "run", side_effect=draw)
        code, _payload = self.preview("--at", "1")
        self.assertNotEqual(code, 0)
        self.assertEqual(seen, [preview_edl])
        self.assertEqual((render_edl.read_bytes(), render_audio.read_bytes()), (before, b"render audio"))
        self.assertFalse((self.work / "edl" / "v1.csv").exists())
        self.assertEqual(sorted(path.name for path in self.work.iterdir() if path.name.startswith(".")), [])

    def test_named_times_come_back_as_work_relative_stills(self):
        self.draw("1.5", "3")
        code, payload = self.preview("--at", "1.5", "--at", "3")
        self.assertEqual(code, 0, payload)
        self.assertEqual(payload, {"stills": [{"at": 1.5, "path": "stills/v1.hf/t1.5.png"}, {"at": 3.0, "path": "stills/v1.hf/t3.png"}]})
        self.edit.assert_called_once_with("v1", "media/s.mkv", with_audio=False)
        self.assertEqual(self.drawn[0][0], "node")
        self.assertEqual(self.drawn[0][2:], ["v1:v1", "--stills", "1.5", "3"])

    # Review (Maya): with only captions left render.js takes no stills, and an earlier preview's stills came back.
    def test_auto_never_returns_an_earlier_previews_stills(self):
        stale = self.work / "stills" / "v1.hf" / "t9.png"
        stale.parent.mkdir(parents=True)
        stale.write_bytes(b"png")
        self.draw()
        code, payload = self.preview()
        self.assertEqual((code, payload), (0, {"stills": []}))

    def test_auto_returns_the_first_four_stills_by_time(self):
        self.draw("7", "0.5", "10", "2", "4.25")
        code, payload = self.preview("--guides")
        self.assertEqual(code, 0, payload)
        self.assertEqual([still["at"] for still in payload["stills"]], [0.5, 2.0, 4.25, 7.0])
        self.assertEqual(self.drawn[0][2:], ["v1:v1", "--stills", "auto", "--guides", "--max", "4"])  # capped before drawing

    def test_a_still_render_js_did_not_write_fails_the_gate(self):
        self.draw("1.5")
        code, payload = self.preview("--at", "1.5", "--at", "3")
        self.assertEqual(code, cli.EXIT_GATE_FAILED, payload)
        self.assertIn("t3.png", payload["error"]["message"])

    def test_refuses_more_than_four_times_before_editing(self):
        self.assert_refused("render-preview", "--json", "--video", "v1", "--source", "media/s.mkv",
                            *[arg for at in range(5) for arg in ("--at", str(at))], mentions="4")
        self.edit.assert_not_called()


if __name__ == "__main__":
    unittest.main()
