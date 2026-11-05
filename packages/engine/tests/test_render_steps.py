# Created by The Angelo Umali.
# Overlay steps report their own reason when they fail, and a preview encodes the footage cards it plays.
import subprocess
import unittest
from unittest import mock

from support import ENGINE  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import render
from zks_engine.render import commands
from zks_engine.specs.gates import GateFailed


class RunStepTests(unittest.TestCase):
    def test_a_failed_step_names_its_last_error_line_not_its_exit_code(self):
        failed = subprocess.CompletedProcess([], 1, None, 'CUE WARNING: snapped\nbigWord "PASSWORD" is 1296 px wide at size 240\n')
        with mock.patch.object(render.subprocess, "run", return_value=failed), self.assertRaisesRegex(GateFailed, r'render\.js: bigWord "PASSWORD" is 1296 px wide'):
            render.run_step(["node", "render.js", "v1"], "render.js")

    def test_a_passing_step_returns_quietly(self):
        passed = subprocess.CompletedProcess([], 0, None, "")
        with mock.patch.object(render.subprocess, "run", return_value=passed):
            render.run_step(["node", "render.js", "v1"], "render.js")


class PreviewCardTests(unittest.TestCase):
    def test_a_preview_encodes_its_footage_cards_with_the_project_style_before_the_stills(self):
        order = []
        args = mock.Mock(at=[2.0], guides=False, source="sources/v1.mkv")
        with (
            mock.patch.object(commands.stages, "edit_stage"),
            mock.patch.object(commands, "cue_sheet_names", return_value=["v1", "v1-cc"]),
            mock.patch.object(commands, "style_flags", return_value=["--style", "style.json"]),
            mock.patch.object(commands, "run_step", side_effect=lambda command, name: order.append(command)),
            mock.patch.object(commands, "render_stills", side_effect=lambda *a: order.append("stills") or commands.pipeline.WORK),
            mock.patch.object(commands.Path, "is_file", return_value=True),
        ):
            commands.draw_preview("v1", args)
        self.assertEqual(order[0][-4:], ["zks_engine.cardclip", "v1:v1+v1-cc", "--style", "style.json"])
        self.assertEqual(order[1], "stills")


if __name__ == "__main__":
    unittest.main()
