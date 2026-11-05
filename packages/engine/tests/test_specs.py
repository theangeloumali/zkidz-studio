# Created by The Angelo Umali.
# JSON specs: schema validation, cue validators, cut objects and the media-path assertion.
import os
import tempfile
import unittest
from pathlib import Path

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine.specs import SpecError, check_cue, cut_spec_to_engine, inside_project, load_spec, migrate_cue_sheet, migrate_cuts, validate

ASSET = "123e4567-e89b-42d3-a456-426614174000"


def cut_spec(**extra):
    return {"schemaVersion": 1, "sourceAssetId": ASSET, "durationS": 20.0, "fps": {"num": 30000, "den": 1001}, "removals": [], **extra}


class SchemaTests(unittest.TestCase):
    def test_valid_cut_spec_passes(self):
        validate("cut-spec", cut_spec(removals=[{"at": 1.0, "end": 2.0, "reason": "um"}]))

    def test_cut_spec_with_a_path_fails(self):
        with self.assertRaisesRegex(SpecError, "source"):
            validate("cut-spec", cut_spec(source="/etc/passwd"))

    def test_error_names_the_failing_field(self):
        with self.assertRaisesRegex(SpecError, r"removals\[0\]"):
            validate("cut-spec", cut_spec(removals=[{"at": 1.0, "end": 2.0}]))

    def test_unknown_spec_kind_is_rejected(self):
        with self.assertRaisesRegex(SpecError, "unknown spec kind"):
            validate("nope", {})

    def test_every_shared_schema_loads(self):
        samples = {"cut-spec": cut_spec(), "reel-spec": {"schemaVersion": 1, "baseVideoId": "v1", "keep": [{"at": 0, "end": 3}]}}
        for kind in ("cut-spec", "reel-spec", "cue-sheet", "reel-cue-patches", "caption-entries", "caption-phrases", "insert-spec"):
            validate(kind, samples.get(kind, []))

    def test_load_spec_reads_and_validates_a_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "v1.json"
            path.write_text('[{"kind": "comment", "at": 1, "end": 2, "text": "hi"}]', encoding="utf-8")
            self.assertEqual(load_spec("cue-sheet", path)[0]["text"], "hi")
            path.write_text("{not json", encoding="utf-8")
            with self.assertRaisesRegex(SpecError, "v1.json"):
                load_spec("cue-sheet", path)


class CueValidationTests(unittest.TestCase):
    def test_pipeline_with_steps_fails(self):
        cue = {"kind": "pipeline", "at": 1, "end": 3, "steps": [{"label": "a", "at": 0}]}
        with self.assertRaisesRegex(SpecError, "pipeline"):
            check_cue(cue)

    def test_pipeline_with_three_labels_passes(self):
        check_cue({"kind": "pipeline", "at": 1, "end": 3, "labels": ["a", "b", "c"]})

    def test_chip_over_max_chars_fails(self):
        cue = {"kind": "keyword", "at": 1, "end": 2, "tone": "chip", "text": "Enterprise clients: teams on Claude"}
        with self.assertRaisesRegex(SpecError, "27"):
            check_cue(cue)

    def test_chip_at_max_chars_passes_and_paper_is_not_capped(self):
        check_cue({"kind": "keyword", "at": 1, "end": 2, "tone": "chip", "text": "x" * 27})
        check_cue({"kind": "keyword", "at": 1, "end": 2, "tone": "paper", "text": "x" * 40})

    def test_theme_limits_override_and_cover_list_slots(self):
        cue = {"kind": "hookTitle", "at": 0, "end": 2, "lines": ["short", "far too long line"]}
        with self.assertRaisesRegex(SpecError, r"lines\[1\]"):
            check_cue(cue, max_chars={"hookTitle": {"lines": 10}})

    def test_end_before_at_fails(self):
        with self.assertRaisesRegex(SpecError, "end"):
            check_cue({"kind": "comment", "at": 3, "end": 2, "text": "hi"})


class CutObjectTests(unittest.TestCase):
    def test_new_spec_maps_to_the_engine_shape(self):
        spec = cut_spec(
            removals=[{"at": 1.0, "end": 2.0, "reason": "um", "pin": True}, {"at": 5.0, "end": 6.0, "reason": "retake"}],
            trimPauses={"thresholdDb": -40, "minS": 0.6, "keepS": 0.25, "exclude": [{"at": 8, "end": 9}]},
            faceCamRanges=[{"at": 0, "end": 20}],
            bleeps=[{"at": 3, "end": 3.4, "x": 540, "y": 900}],
            blurBoxes=[{"at": 0, "end": 4, "x": 10, "y": 20, "w": 30, "h": 40, "reason": "kid photo"}],
            zooms=[{"at": 2, "end": 3, "preset": "push", "cx": 0.4}],
            matteRanges=[{"at": 1, "end": 2}],
            cutaways=[{"at": 4, "end": 5, "title": "Later"}],
        )
        engine = cut_spec_to_engine(spec)
        self.assertEqual(engine["duration"], 20.0)
        self.assertEqual(engine["remove"], [[1.0, 2.0, "um", "pin"], [5.0, 6.0, "retake"]])
        self.assertEqual(engine["trim_pauses"], {"threshold_db": -40, "min": 0.6, "keep": 0.25, "exclude": [[8, 9]]})
        self.assertEqual(engine["facecam"], [[0, 20]])
        self.assertEqual(engine["bleep"], [[3, 3.4, 540, 900]])
        self.assertEqual(engine["blur"], [[0, 4, 10, 20, 30, 40, "kid photo"]])
        self.assertEqual(engine["zooms"], [[2, 3, "push", 0.4]])
        self.assertEqual(engine["matte"], [[1, 2]])
        self.assertEqual(engine["cutaways"], [{"at": 4, "end": 5, "title": "Later"}])
        self.assertNotIn("source", engine)

    def test_cy_without_cx_keeps_the_default_centre_x(self):
        engine = cut_spec_to_engine(cut_spec(zooms=[{"at": 2, "end": 3, "preset": "push", "cy": 0.3}]))
        self.assertEqual(engine["zooms"], [[2, 3, "push", 0.5, 0.3]])

    def test_a_focus_window_brings_its_own_matte(self):
        # Rack focus blurs outside his mask; OpenCode set focus alone and the render failed asking for matte.py.
        engine = cut_spec_to_engine(cut_spec(focus=[{"at": 2, "end": 4, "amount": 12}, {"at": 9, "end": 10, "amount": 8}],
                                             matteRanges=[{"at": 3, "end": 6}]))
        self.assertEqual(engine["matte"], [[2, 6], [9, 10]])

    def test_portal_corners_flatten(self):
        corners = [{"x": 1, "y": 2}, {"x": 3, "y": 4}, {"x": 5, "y": 6}, {"x": 7, "y": 8}]
        engine = cut_spec_to_engine(cut_spec(portals=[{"at": 1, "end": 2, "corners": corners}]))
        self.assertEqual(engine["portals"], [[1, 2, 1, 2, 3, 4, 5, 6, 7, 8]])

    def test_without_trim_pauses_nothing_is_trimmed(self):
        self.assertGreater(cut_spec_to_engine(cut_spec())["trim_pauses"]["min"], 20.0)

    def test_invalid_spec_is_rejected_before_mapping(self):
        with self.assertRaises(SpecError):
            cut_spec_to_engine(cut_spec(removals=[{"at": -1, "end": 2, "reason": "x"}]))


class InsideProjectTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="zks-project-"))
        self.media = self.root / "media"
        self.media.mkdir()
        (self.media / "clip.mp4").write_bytes(b"x")

    def test_file_in_media_resolves(self):
        self.assertEqual(inside_project(self.media / "clip.mp4", self.media), (self.media / "clip.mp4").resolve())

    def test_dot_dot_escape_fails(self):
        with self.assertRaisesRegex(SpecError, "outside"):
            inside_project(self.media / ".." / ".." / "etc" / "passwd", self.media)

    def test_absolute_path_elsewhere_fails(self):
        with self.assertRaisesRegex(SpecError, "outside"):
            inside_project("/etc/passwd", self.media)

    def test_sibling_with_a_shared_prefix_fails(self):
        (self.root / "media-evil").mkdir()
        with self.assertRaisesRegex(SpecError, "outside"):
            inside_project(self.root / "media-evil" / "x.mp4", self.media)

    @unittest.skipIf(os.name == "nt", "symlinks need privileges on Windows")
    def test_symlink_out_of_media_fails(self):
        target = Path(tempfile.mkdtemp()) / "secret.mp4"
        target.write_bytes(b"x")
        (self.media / "link.mp4").symlink_to(target)
        with self.assertRaisesRegex(SpecError, "outside"):
            inside_project(self.media / "link.mp4", self.media)

    def test_registered_in_place_file_passes(self):
        elsewhere = Path(tempfile.mkdtemp()) / "keep.mp4"
        elsewhere.write_bytes(b"x")
        self.assertEqual(inside_project(elsewhere, self.media, registered=[elsewhere]), elsewhere.resolve())


class LiveMotionFieldTests(unittest.TestCase):
    """The v2 Live Motion look: rack focus, the grade and reframes reach the engine and survive a migration back."""

    def test_focus_grade_and_reframes_map_to_engine_rows(self):
        engine = cut_spec_to_engine(cut_spec(focus=[{"at": 2, "end": 4, "amount": 12}], grade="learning",
                                             reframes=[{"at": 1, "end": 3, "cx": 0.3}, {"at": 5, "end": 6, "cx": 0.7, "cy": 0.4, "scale": 1.5}]))
        self.assertEqual(engine["focus"], [[2, 4, 12]])
        self.assertEqual(engine["grade"], "learning")
        self.assertEqual(engine["reframes"], [[1, 3, 0.3, 0.5, 1], [5, 6, 0.7, 0.4, 1.5]])

    def test_follow_and_the_blur_answer_reach_the_edit_stage(self):
        engine = cut_spec_to_engine(cut_spec(follow="speaker", blurFaces="others"))
        self.assertEqual((engine["follow"], engine["blur_faces"]), ("speaker", "others"))
        self.assertNotIn("follow", cut_spec_to_engine(cut_spec()))

    def test_the_beds_level_reaches_sfx(self):
        sections = [{"at": 0, "kind": "cold"}]
        self.assertEqual(cut_spec_to_engine(cut_spec(music={"sections": sections, "under": 26, "duck": 6}))["bed"], {"under": 26, "duck": 6})
        self.assertNotIn("bed", cut_spec_to_engine(cut_spec(music={"sections": sections})))

    def test_the_grade_defaults_to_house(self):
        self.assertEqual(cut_spec_to_engine(cut_spec())["grade"], "house")

    def test_migrating_back_keeps_focus_grade_and_reframes(self):
        spec = migrate_cuts({"duration": 20.0, "remove": [], "focus": [[2, 4, 12]], "grade": "learning", "reframes": [[1, 3, 0.3, 0.5, 1]]}, ASSET)
        self.assertEqual(spec["focus"], [{"at": 2, "end": 4, "amount": 12}])
        self.assertEqual(spec["grade"], "learning")
        self.assertEqual(spec["reframes"], [{"at": 1, "end": 3, "cx": 0.3, "cy": 0.5, "scale": 1}])

    def test_a_legacy_cue_sheet_keeps_depth_behind(self):
        cues, warnings = migrate_cue_sheet('const CUE_SHEET = [{ kind: "keyword", at: 1, end: 2, text: "Hi", depth: "behind" }];')
        self.assertEqual(cues[0]["depth"], "behind")
        self.assertEqual(warnings, [])


if __name__ == "__main__":
    unittest.main()
