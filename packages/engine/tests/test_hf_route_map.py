# Created by The Angelo Umali.
# routeMap (learning kind): a real map of Natural Earth land with a dashed gold route that draws from stop to stop on each
# pin's beat. Projection, label placement and timing are checked on the module's own layout; the page text on the render.
import json
import shutil
import subprocess
import unittest
from pathlib import Path

from test_hf_learning import SoundsAndSeeksMixin, render, specs, texts  # first: the engine path
from support import ENGINE

LAYOUT_PROBE = """
const path = require("path");
const input = JSON.parse(require("fs").readFileSync(0, "utf8"));
const map = require(path.join(process.argv[1], "hf", "components", "learning", "route-map.js"));
const cue = { seed: 9001, start: 1, stop: 4, ...input.cue };
if (input.projection) {
  const [box, region] = input.projection;
  const project = map.projection(box, region);
  const spots = [[135, 35], [150, 35], [120, 35], [135, 50]];
  console.log(JSON.stringify({ points: Object.fromEntries(spots.map(([lon, lat]) => [`${lon},${lat}`, project(lon, lat)])) }));
} else console.log(JSON.stringify(map.layout(cue, cue.stop - cue.start)));
"""
GEO = ENGINE / "hf" / "components" / "learning" / "geo"
PORTRAIT, LANDSCAPE = [1080, 1920], [1920, 1080]

KYOTO = {"name": "Kyoto", "sub": "Spring 2024", "lon": 135.768, "lat": 35.011, "at": 0.6}
TOKYO = {"name": "Tokyo", "sub": "Autumn 2023", "lon": 139.692, "lat": 35.689, "at": 1.5}
SAPPORO = {"name": "Sapporo", "sub": "Winter 2025", "lon": 141.354, "lat": 43.062, "at": 2.4}
OSAKA = {"name": "Osaka", "sub": "Spring 2024", "lon": 135.502, "lat": 34.694, "at": 1.1}
CUE = {"kind": "routeMap", "region": "japan", "full": True, "stops": [KYOTO, TOKYO, SAPPORO], "stop": 4}


def layout(**cue):
    result = subprocess.run(["node", "-e", LAYOUT_PROBE, str(ENGINE)], capture_output=True, text=True, encoding="utf-8", input=json.dumps({"cue": cue}))
    if result.returncode:
        raise AssertionError(result.stderr)
    return json.loads(result.stdout)


def projection(box, region):
    result = subprocess.run(["node", "-e", LAYOUT_PROBE, str(ENGINE)], capture_output=True, text=True, encoding="utf-8",
                            input=json.dumps({"projection": [box, region]}))
    if result.returncode:
        raise AssertionError(result.stderr)
    return json.loads(result.stdout)


def overlap(a, b):
    return a["x"] < b["x"] + b["w"] and b["x"] < a["x"] + a["w"] and a["y"] < b["y"] + b["h"] and b["y"] < a["y"] + a["h"]


def inside(rect, box):
    return rect["x"] >= box[0] and rect["y"] >= box[1] and rect["x"] + rect["w"] <= box[0] + box[2] and rect["y"] + rect["h"] <= box[1] + box[3]


@unittest.skipUnless(shutil.which("node"), "needs node")
class ProjectionTests(unittest.TestCase):
    def test_a_known_lon_lat_lands_at_the_expected_pixel(self):
        # region 120-150E, 20-50N in 1080x1920: centre (135E, 35N) at the box centre; cos(35 deg) widens the degree
        # so 15 deg east is the right edge, and 15 deg north is 15 * scale up from the centre.
        pin = projection([0, 0, 1080, 1920], [120, 20, 150, 50])
        scale = 1080 / (30 * 0.8191520443)
        for lon, lat, x, y in [(135, 35, 540, 960), (150, 35, 1080, 960), (120, 35, 0, 960), (135, 50, 540, 960 - 15 * scale)]:
            [px, py] = pin["points"][f"{lon},{lat}"]
            self.assertAlmostEqual(px, x, delta=2)
            self.assertAlmostEqual(py, y, delta=2)

    def test_the_box_origin_offsets_every_point(self):
        base = projection([0, 0, 900, 610], [128.5, 30, 146.5, 46])["points"]["135,35"]
        moved = projection([90, 270, 900, 610], [128.5, 30, 146.5, 46])["points"]["135,35"]
        self.assertAlmostEqual(moved[0] - base[0], 90, delta=0.01)
        self.assertAlmostEqual(moved[1] - base[1], 270, delta=0.01)


@unittest.skipUnless(shutil.which("node"), "needs node")
class RouteMapTests(SoundsAndSeeksMixin, unittest.TestCase):
    def test_every_stop_draws_its_name_and_sub(self):
        words = texts(render(**CUE)["html"])
        for stop in (KYOTO, TOKYO, SAPPORO):
            self.assertIn(stop["name"], words)
            self.assertIn(stop["sub"], words)

    def test_the_route_is_undrawn_before_stop_two_and_whole_after_the_last_pin(self):
        drawn = render(**CUE)
        segments = [spec for spec in specs(drawn) if spec["target"].startswith(".rm-draw")]
        self.assertEqual(len(segments), 2)
        for spec in segments:
            self.assertEqual(spec["from"]["strokeDashoffset"], 1.1, "starts fully undrawn")
            self.assertEqual(spec["to"]["strokeDashoffset"], 0, "ends fully drawn")
        self.assertGreaterEqual(min(spec["at"] for spec in segments), TOKYO["at"], "no route before stop 2's pin")
        self.assertAlmostEqual(segments[0]["at"], TOKYO["at"])
        self.assertAlmostEqual(segments[1]["at"], SAPPORO["at"])
        self.assertLessEqual(max(spec["at"] + spec["to"]["duration"] for spec in segments), 3.0, "whole before the cue ends")

    def test_a_departure_ring_adds_the_first_leg_on_the_first_pin(self):
        drawn = render(**{**CUE, "from": {"name": "Bangkok", "lon": 100.502, "lat": 13.756}, "region": "asia", "stops": [KYOTO, TOKYO]})
        legs = [spec for spec in specs(drawn) if spec["target"].startswith(".rm-draw")]
        self.assertEqual(len(legs), 2)
        self.assertAlmostEqual(min(spec["at"] for spec in legs), KYOTO["at"])
        self.assertIn("Bangkok", texts(drawn["html"]))

    def test_one_stop_has_a_pin_and_a_label_but_no_route(self):
        drawn = render(**{**CUE, "stops": [KYOTO]})
        self.assertFalse([spec for spec in specs(drawn) if spec["target"].startswith(".rm-draw")])
        self.assertIn("Kyoto", texts(drawn["html"]))
        self.assertEqual(len(layout(**{**CUE, "stops": [KYOTO]})["labels"]), 1)

    def test_the_pin_turns_gold_when_the_next_one_lands_and_pulses_a_ring(self):
        drawn = render(**CUE)
        hot = [spec for spec in specs(drawn) if spec["target"] == ".rm-hot0"]
        self.assertTrue(hot and abs(hot[0]["at"] - TOKYO["at"]) < 1e-6, "the current pin hands over on the next pin's beat")
        self.assertTrue([spec for spec in specs(drawn) if spec["target"] == ".rm-ring1"], "a ring pulse on the new pin")
        self.assertIn("#EA580C", drawn["html"])
        self.assertIn("#C9A838", drawn["html"])

    def test_labels_rise_over_a_third_to_half_a_second_on_their_pin(self):
        drawn = render(**CUE)
        for index, stop in enumerate((KYOTO, TOKYO, SAPPORO)):
            [rise] = [spec for spec in specs(drawn) if spec["target"] == f".rm-label{index}"]
            self.assertAlmostEqual(rise["at"], stop["at"])
            self.assertTrue(0.3 <= rise["to"]["duration"] <= 0.5)
            self.assertGreater(rise["from"]["y"], 0)

    def test_follow_eases_the_view_by_at_most_eight_percent(self):
        drawn = render(**{**CUE, "follow": True})
        [world] = [spec for spec in specs(drawn) if spec["target"] == ".rm-world"]
        frames = world["to"]["keyframes"]
        self.assertTrue(all(abs(frame.get("scale", 1) - 1) <= 0.08 for frame in frames))
        self.assertGreater(max(frame.get("scale", 1) for frame in frames), 1.0)
        self.assertFalse([spec for spec in specs(render(**CUE)) if spec["target"] == ".rm-world"], "still without follow")

    def test_the_route_keeps_flowing_while_it_holds(self):
        flow = [spec for spec in specs(render(**CUE)) if spec["target"] == ".rm-flow"]
        self.assertTrue(flow and flow[0]["to"]["duration"] >= 3.0 - 1e-6)

    def test_sounds_are_a_tick_per_pin_and_seeks_are_safe(self):
        drawn = render(**CUE)
        self.assertEqual([(event["at"], event["sound"]) for event in drawn["sfx"]], [(0.6, "tick"), (1.5, "tick"), (2.4, "tick")])
        self.assert_sound_and_seek_safe(drawn)

    def test_the_way_out_is_a_short_bounded_fade(self):
        [out] = [spec for spec in render(**CUE)["exit"]]
        self.assertAlmostEqual(out["at"] + out["to"]["duration"], 3.0, places=6)
        self.assertLessEqual(out["to"]["duration"], 0.5)


PLACE_PROBE = """
const path = require("path");
const { placeLabel } = require(path.join(process.argv[1], "hf", "components", "learning", "geo", "labels.js"));
const { pin, size, bounds } = JSON.parse(require("fs").readFileSync(0, "utf8"));
console.log(JSON.stringify(placeLabel(pin, size, bounds, [], [pin]).rect));
"""


def placed(pin, size, bounds):
    result = subprocess.run(["node", "-e", PLACE_PROBE, str(ENGINE)], capture_output=True, text=True, encoding="utf-8",
                            input=json.dumps({"pin": pin, "size": size, "bounds": bounds}))
    if result.returncode:
        raise AssertionError(result.stderr)
    return json.loads(result.stdout)


@unittest.skipUnless(shutil.which("node"), "needs node")
class LabelClampTests(unittest.TestCase):
    BOX = [100, 100, 200, 120]

    def test_a_label_wider_than_the_room_on_every_side_is_clamped_inside_the_box(self):
        for pin in ([102, 102], [298, 218], [200, 160], [102, 218]):
            rect = placed(pin, {"width": 190, "height": 70}, self.BOX)
            self.assertTrue(inside(rect, self.BOX), f"{pin} -> {rect}")

    def test_a_box_hanging_off_the_frame_clamps_to_the_frame_too(self):
        rect = layout(**{**CUE, "full": False, "box": {"x": 400, "y": 300, "w": 1000, "h": 500}, "stops": [
            {"name": "Huis Ten Bosch", "sub": "Nagasaki", "lon": 129.78, "lat": 33.08, "at": 0.5}]})["labels"][0]
        self.assertLessEqual(rect["x"] + rect["w"], 1080)


@unittest.skipUnless(shutil.which("node"), "needs node")
class RouteMapLayoutTests(unittest.TestCase):
    def test_a_label_near_the_right_edge_flips_to_the_left_and_stays_inside(self):
        edge = {"name": "Nemuro", "sub": "Hokkaido east", "lon": 145.6, "lat": 43.3, "at": 0.5}
        placed = layout(**{**CUE, "stops": [edge]})
        [label], [pin] = placed["labels"], placed["pins"]
        self.assertLessEqual(label["x"] + label["w"], pin["x"], "left of its pin")
        self.assertTrue(inside(label, placed["box"]))

    def test_a_label_near_the_left_edge_stays_on_the_right(self):
        edge = {"name": "Naha", "sub": "Okinawa", "lon": 127.68, "lat": 26.21, "at": 0.5}
        placed = layout(**{**CUE, "stops": [edge]})
        [label], [pin] = placed["labels"], placed["pins"]
        self.assertGreaterEqual(label["x"], pin["x"])
        self.assertTrue(inside(label, placed["box"]))

    def test_osaka_and_kyoto_under_forty_pixels_apart_do_not_collide(self):
        placed = layout(**{**CUE, "stops": [KYOTO, OSAKA]})
        a, b = placed["pins"]
        self.assertLess(((a["x"] - b["x"]) ** 2 + (a["y"] - b["y"]) ** 2) ** 0.5, 40)
        first, second = placed["labels"]
        self.assertFalse(overlap(first, second))
        for label, pin in ((first, b), (second, a)):
            self.assertFalse(overlap(label, {"x": pin["x"] - 11, "y": pin["y"] - 11, "w": 22, "h": 22}), "a label never covers the other pin")
        for label in (first, second):
            self.assertTrue(inside(label, placed["box"]))

    def test_landscape_draws_a_different_box_and_different_pins(self):
        portrait, landscape = layout(**CUE), layout(**{**CUE, "size": LANDSCAPE})
        self.assertEqual(portrait["box"], [0, 0, 1080, 1920])
        self.assertEqual(landscape["box"], [0, 0, 1920, 1080])
        self.assertNotEqual(portrait["pins"], landscape["pins"])
        self.assertNotEqual(render(**CUE)["html"], render(**{**CUE, "size": LANDSCAPE})["html"])
        for placed in (portrait, landscape):
            for label in placed["labels"]:
                self.assertTrue(inside(label, placed["box"]))

    def test_the_inset_defaults_to_the_top_band_and_the_landscape_inset_to_the_left(self):
        portrait = layout(**{**CUE, "full": False})["box"]
        landscape = layout(**{**CUE, "full": False, "size": LANDSCAPE})["box"]
        self.assertGreaterEqual(portrait[1], 270)
        self.assertLessEqual(portrait[1] + portrait[3], 880)
        self.assertNotEqual(portrait, landscape)
        self.assertLessEqual(landscape[0] + landscape[2], 0.55 * 1920 + 1)
        self.assertEqual(layout(**{**CUE, "full": False, "box": {"x": 100, "y": 300, "w": 800, "h": 500}})["box"], [100, 300, 800, 500])

    def test_every_label_clears_every_pin_in_the_full_portrait_route(self):
        placed = layout(**{**CUE, "follow": True})
        for label in placed["labels"]:
            for pin in placed["pins"]:
                self.assertFalse(overlap(label, {"x": pin["x"] - 11, "y": pin["y"] - 11, "w": 22, "h": 22}))


@unittest.skipUnless(shutil.which("node"), "needs node")
class RouteMapRefusalTests(unittest.TestCase):
    def test_a_pin_after_the_cue_ends_is_refused_by_name(self):
        with self.assertRaisesRegex(AssertionError, "Sapporo"):
            render(**{**CUE, "stop": 3.0})

    def test_a_stop_off_the_map_is_refused_by_name(self):
        with self.assertRaisesRegex(AssertionError, "Paris"):
            render(**{**CUE, "stops": [{"name": "Paris", "lon": 2.35, "lat": 48.86, "at": 0.5}]})

    def test_stops_out_of_order_and_unknown_regions_are_refused(self):
        with self.assertRaisesRegex(AssertionError, "order"):
            render(**{**CUE, "stops": [TOKYO, KYOTO]})
        with self.assertRaisesRegex(AssertionError, "region"):
            render(**{**CUE, "region": "mars"})

    def test_a_box_across_the_antimeridian_is_refused(self):
        with self.assertRaisesRegex(AssertionError, "antimeridian"):
            render(**{**CUE, "region": [170, 30, -170, 50]})


class GeoDataTests(unittest.TestCase):
    def test_the_vendored_land_is_small_and_credits_natural_earth(self):
        total = sum(path.stat().st_size for path in GEO.iterdir())
        self.assertLess(total, 400 * 1024)
        self.assertIn("Natural Earth", (GEO / "land.js").read_text(encoding="utf-8")[:400])
        self.assertIn("public domain", (GEO / "land.js").read_text(encoding="utf-8")[:400].lower())


if __name__ == "__main__":
    unittest.main()
