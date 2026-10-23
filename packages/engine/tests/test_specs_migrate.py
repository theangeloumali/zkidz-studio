# Created by The Angelo Umali.
# Legacy migrators: positional cut JSON and literal JS cue sheets become the JSON spec shapes.
import unittest

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine.specs import SpecError, cut_spec_to_engine, migrate_cue_sheet, migrate_cuts, validate

ASSET = "123e4567-e89b-42d3-a456-426614174000"


class MigrateCutsTests(unittest.TestCase):
    LEGACY = {
        "source": "media/raw/clip.mp4",
        "duration": 20.0,
        "remove": [[1.0, 2.0, "um", "pin"], [5.0, 6.0, "retake"]],
        "trim_pauses": {"threshold_db": -40, "min": 0.6, "keep": 0.25, "exclude": [[8, 9]]},
        "facecam": [[0, 20]],
        "bleep": [[3, 3.4, 540, 900]],
        "blur": [[0, 4, 10, 20, 30, 40, "kid photo"]],
        "zooms": [[2, 3, "push", 0.4, 0.3]],
        "portals": [[1, 2, 1, 2, 3, 4, 5, 6, 7, 8]],
        "matte": [[1, 2]],
        "cutaways": [{"at": 4, "end": 5, "title": "Later"}],
        "base": "v3",
        "reel": True,
    }

    def test_round_trip_through_the_engine_shape(self):
        migrated = migrate_cuts(self.LEGACY, ASSET)
        validate("cut-spec", migrated)
        self.assertEqual(migrated["removals"][0], {"at": 1.0, "end": 2.0, "reason": "um", "pin": True})
        self.assertEqual(migrated["fps"], {"num": 30000, "den": 1001})
        self.assertEqual(migrated["baseVideoId"], "v3")
        self.assertTrue(migrated["isReel"])
        engine = cut_spec_to_engine(migrated)
        for key in ("duration", "remove", "trim_pauses", "facecam", "bleep", "blur", "zooms", "portals", "matte", "cutaways"):
            self.assertEqual(engine[key], self.LEGACY[key], key)

    def test_the_path_is_replaced_by_the_asset_id(self):
        migrated = migrate_cuts(self.LEGACY, ASSET)
        self.assertEqual(migrated["sourceAssetId"], ASSET)
        self.assertNotIn("source", migrated)


class MigrateCueSheetTests(unittest.TestCase):
    def test_literal_sheet_migrates_and_reports_dropped_style(self):
        source = """// header
        const CUE_SHEET = [
          { kind: "hookTitle", at: 0.5, end: 3.5, kicker: 'How', lines: ["From $12", `to $25.`], accentLine: 1, },
          { kind: "slamStamp", at: 14.9, end: 16.6, text: "BIG", x: 540, y: 420, size: 84, color: BRAND.ink, rot: -0.06 },
          /* block */ { kind: "pipeline", at: 20, end: 22, steps: [{ label: "a", at: 0 }, { label: "b", at: 1 }, { label: "c", at: 2 }] },
        ];
        """
        cues, warnings = migrate_cue_sheet(source)
        validate("cue-sheet", cues)
        self.assertEqual(cues[0]["lines"], ["From $12", "to $25."])
        self.assertEqual(cues[1], {"kind": "slamStamp", "at": 14.9, "end": 16.6, "text": "BIG", "x": 540, "y": 420})
        self.assertEqual(cues[2]["labels"], ["a", "b", "c"])
        self.assertTrue(any("size" in warning and "slamStamp@14.9" in warning for warning in warnings))
        self.assertTrue(any("color" in warning for warning in warnings))

    def test_unknown_kind_is_dropped_with_a_warning(self):
        cues, warnings = migrate_cue_sheet('const CUE_SHEET = [{ kind: "sparkle", at: 1, end: 2 }];')
        self.assertEqual(cues, [])
        self.assertIn("sparkle", warnings[0])

    def test_a_cue_failing_its_schema_is_dropped_with_the_reason(self):
        cues, warnings = migrate_cue_sheet('const CUE_SHEET = [{ kind: "comment", at: 1, end: 2 }];')
        self.assertEqual(cues, [])
        self.assertIn("text", warnings[0])

    def test_code_outside_the_literal_is_never_executed(self):
        with self.assertRaisesRegex(SpecError, "CUE_SHEET"):
            migrate_cue_sheet("require('child_process').execSync('touch pwned')")

    def test_a_call_inside_the_literal_is_rejected(self):
        with self.assertRaisesRegex(SpecError, "line 1"):
            migrate_cue_sheet('const CUE_SHEET = [{ kind: "comment", at: f(), end: 2, text: "x" }];')

    def test_gallery_fixture_migrates_to_a_valid_sheet(self):
        cues, _ = migrate_cue_sheet(support.GALLERY.read_text(encoding="utf-8"))
        validate("cue-sheet", cues)
        self.assertGreater(len(cues), 15)


if __name__ == "__main__":
    unittest.main()
