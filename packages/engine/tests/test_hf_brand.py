# Created by The Angelo Umali.
# The HyperFrames brand layer: the canvas page's own drawing code runs in Node against an SVG-recording 2D context
# (hf/brand/canvas.js), so cards, rules and kickers keep the canvas geometry and frozen per-cue wobble. Needs node and
# the film kit (fonts and kit scripts).
import json
import re
import subprocess
import unittest

from support import ENGINE, HF_SKIP, hf_installed  # first: it sets a scratch ZKS_HOME

from zks_engine import doctor


def node_json(script):
    result = subprocess.run(["node", "-e", script], cwd=ENGINE / "hf", capture_output=True, text=True, encoding="utf-8")
    if result.returncode:
        raise AssertionError(result.stderr)
    return json.loads(result.stdout)


CARD = """
const { canvasBrand } = require("./brand/canvas");
const { still } = canvasBrand();
const card = (seed) => still(seed, "c", (k, capture) => ({
  shadow: capture(() => k.dropShadow(k.rectPoints(0, 0, 950, 300))),
  body: capture(() => k.sketchRect(0, 0, 950, 300, { fill: k.BRAND.paper, color: k.BRAND.lineStrong, width: 3.5, passes: 1, rough: 1, overshoot: 0 })),
}));
console.log(JSON.stringify({ first: card(9001), again: card(9001), other: card(9002) }));
"""

RECORDER = """
const { SvgRecorder } = require("./brand/recorder");
const r = new SvgRecorder("t");
const fragment = r.capture(() => {
  r.save(); r.translate(10, 20); r.scale(2, 2); r.lineWidth = 3; r.strokeStyle = "#123";
  r.beginPath(); r.moveTo(0, 0); r.lineTo(5, 0); r.stroke(); r.restore();
  r.globalAlpha = 0.5; r.fillStyle = "#abc"; r.fillRect(1, 2, 3, 4);
  r.beginPath(); r.rect(0, 0, 10, 10); r.clip(); r.font = '600 32px "Inter"'; r.letterSpacing = "4px"; r.fillText("AB", 7, 9);
});
console.log(JSON.stringify({ fragment, tracked: r.measureText("AB").width }));
"""

FONTS = """
const fonts = require("./brand/fonts");
const fs = require("fs");
const { scope } = require("./brand/canvas").canvasBrand();
const display = { ...scope.TYPE.display, size: 108 };
console.log(JSON.stringify({
  assets: Object.entries(fonts.fontAssets()).map(([published, source]) => [published, fs.existsSync(source)]),
  css: fonts.fontFaceCss(),
  width: scope.textWidth("Three tracks to a raise", display),
  ink: scope.BRAND.ink, display: scope.TYPE.display,
}));
"""


@unittest.skipUnless(hf_installed() and doctor.check_kit()[0], HF_SKIP)
class BrandTests(unittest.TestCase):
    def test_card_furniture_is_frozen_per_cue_seed(self):
        cards = node_json(CARD)
        self.assertEqual(cards["first"], cards["again"])
        self.assertNotEqual(cards["first"]["body"], cards["other"]["body"])

    def test_card_has_the_canvas_layers(self):
        card = node_json(CARD)["first"]
        self.assertRegex(card["shadow"], r'^<path d="M[^"]+Z" fill="#172230" opacity="0.22"/>$')
        self.assertIn('fill="#f3efe8"', card["body"])
        edges = re.findall(r'stroke="#2e4a64" stroke-width="3.5"', card["body"])
        self.assertEqual(len(edges), 4, "one single-pass sketched stroke per edge")

    def test_recorder_draws_in_page_coordinates(self):
        recorded = node_json(RECORDER)
        fragment = recorded["fragment"]
        self.assertIn('<path d="M10 20L20 20" fill="none" stroke="#123" stroke-width="6"', fragment)  # translate + scale
        self.assertIn('<path d="M1 2L4 2L4 6L1 6Z" fill="#abc" opacity="0.5"/>', fragment)  # fillRect keeps the path
        self.assertRegex(fragment, r'<clipPath id="t-clip1" clipPathUnits="userSpaceOnUse"><path d="M0 0L10 0L10 10L0 10Z"/></clipPath>'
                                   r'<g clip-path="url\(#t-clip1\)"><text x="7" y="9" font-family="Inter" font-size="32" '
                                   r'font-weight="600" letter-spacing="4" fill="#abc" opacity="0.5"')
        # Chrome's canvas counts the letter space after the last letter too.
        plain = node_json('const { advanceWidth } = require("./brand/fonts"); console.log(advanceWidth("AB", { family: "Inter", weight: 600, size: 32 }))')
        self.assertAlmostEqual(recorded["tracked"], plain + 8, places=6)

    def test_text_measures_as_chrome_lays_it_out(self):
        fonts = node_json(FONTS)
        self.assertAlmostEqual(fonts["width"], 1128.4, delta=1.5)  # Chrome's SVG/HTML width for this line
        self.assertEqual((fonts["ink"], fonts["display"]["family"]), ("#172230", "Newsreader"))  # the canvas palette and type

    def test_every_brand_face_ships_with_the_composition(self):
        fonts = node_json(FONTS)
        published = dict(fonts["assets"])
        self.assertEqual(sorted(published), ["fonts/Caveat.ttf", "fonts/Inter.ttf", "fonts/JetBrainsMono.ttf", "fonts/Newsreader.ttf"])
        self.assertTrue(all(published.values()), published)
        for family in ("Newsreader", "Inter", "Caveat", "JetBrains Mono"):
            self.assertIn(f'font-family: "{family}"', fonts["css"])


if __name__ == "__main__":
    unittest.main()
