# Created by The Angelo Umali.
# Theme packs' generated index (plan §7.8): `zks-engine theme-index` writes themes/<id>/index.json from theme.json's
# component manifest, and list_cue_kinds filters it by tier and purpose before the agent opens any component schema.
import contextlib
import io
import json
import shutil
import tempfile
import unittest
import unittest.mock
from pathlib import Path

import support  # noqa: F401  (scratch ZKS_HOME first)
from zks_engine import cli, theme_index

REPO_THEMES = Path(__file__).resolve().parents[3] / "themes"


def scratch_themes():
    folder = Path(tempfile.mkdtemp(prefix="zks-themes-"))
    shutil.copytree(REPO_THEMES, folder, dirs_exist_ok=True)
    for index in folder.glob("*/index.json"):
        index.unlink()
    return folder


class ThemeIndexTests(unittest.TestCase):
    def setUp(self):
        self.root = scratch_themes()
        self.addCleanup(shutil.rmtree, self.root)

    def test_writes_index_json_beside_the_theme(self):
        path = theme_index.write_index("minimal", self.root)
        self.assertEqual(path, self.root / "minimal" / "index.json")
        index = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(index["id"], "minimal")
        self.assertIn("hookTitle", [component["kind"] for component in index["components"]])

    def test_list_cue_kinds_filters_by_tier_from_the_generated_index(self):
        theme_index.write_index("zkidz", self.root)
        core = theme_index.list_cue_kinds("zkidz", tier="core", themes_root=self.root)
        self.assertTrue(core)
        self.assertEqual({entry["tier"] for entry in core}, {"core"})
        self.assertIn("caption", [entry["kind"] for entry in core])
        self.assertNotIn("pipeline", [entry["kind"] for entry in core])
        everything = theme_index.list_cue_kinds("zkidz", themes_root=self.root)
        self.assertGreater(len(everything), len(core))

    def test_list_cue_kinds_filters_by_purpose_words(self):
        theme_index.write_index("zkidz", self.root)
        kinds = [entry["kind"] for entry in theme_index.list_cue_kinds("zkidz", purpose="number", themes_root=self.root)]
        self.assertIn("statTile", kinds)
        self.assertNotIn("caption", kinds)

    def test_an_unknown_tier_is_refused(self):
        theme_index.write_index("zkidz", self.root)
        with self.assertRaisesRegex(theme_index.ThemeError, "tier is core, accent or special"):
            theme_index.list_cue_kinds("zkidz", tier="hero", themes_root=self.root)

    def test_list_cue_kinds_needs_the_index(self):
        with self.assertRaisesRegex(theme_index.ThemeError, "zks-engine theme-index"):
            theme_index.list_cue_kinds("zkidz", themes_root=self.root)

    def test_max_chars_feeds_the_spec_width_check(self):
        theme_index.write_index("zkidz", self.root)
        limits = theme_index.max_chars("zkidz", themes_root=self.root)
        self.assertEqual(limits["keyword:chip"], {"text": 27})
        self.assertEqual(limits["caption"], {"text": 60})
        self.assertNotIn("censor", limits)

    def test_theme_ids_never_reach_outside_themes(self):
        for theme_id in ("../zkidz", "_blueprint", "ZKidz", "/etc", "nope"):
            with self.subTest(theme_id=theme_id), self.assertRaises(theme_index.ThemeError):
                theme_index.write_index(theme_id, self.root)

    def test_a_bad_manifest_names_the_component(self):
        manifest = self.root / "minimal" / "theme.json"
        theme = json.loads(manifest.read_text(encoding="utf-8"))
        theme["components"]["keyword"]["slots"]["text"]["maxChars"] = 0
        manifest.write_text(json.dumps(theme), encoding="utf-8")
        with self.assertRaisesRegex(theme_index.ThemeError, "keyword.slots.text.maxChars"):
            theme_index.write_index("minimal", self.root)

    def test_index_all_skips_the_blueprint(self):
        written = theme_index.write_all(self.root)
        self.assertEqual(sorted(path.parent.name for path in written), ["minimal", "zkidz"])
        self.assertFalse((self.root / "_blueprint" / "index.json").exists())


class CommittedIndexTests(unittest.TestCase):
    def test_every_committed_index_matches_its_theme(self):
        for theme_id in ("zkidz", "minimal"):
            with self.subTest(theme_id=theme_id):
                committed = json.loads((REPO_THEMES / theme_id / "index.json").read_text(encoding="utf-8"))
                self.assertEqual(committed, theme_index.build_index(theme_id, REPO_THEMES), "run zks-engine theme-index --json")


class ThemeIndexCliTests(unittest.TestCase):
    def test_theme_index_command_prints_the_files_it_wrote(self):
        root = scratch_themes()
        self.addCleanup(shutil.rmtree, root)
        out = io.StringIO()
        with contextlib.redirect_stdout(out), unittest.mock.patch.object(theme_index, "THEMES_DIR", root):
            code = cli.main(["theme-index", "--json"])
        self.assertEqual(code, 0)
        self.assertEqual(sorted(json.loads(out.getvalue())["themes"]), ["minimal", "zkidz"])
        self.assertTrue((root / "zkidz" / "index.json").exists())


if __name__ == "__main__":
    unittest.main()
