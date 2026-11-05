# Created by The Angelo Umali.
# The map gate (v2 rule 8, from zkidz-films 1a6508a): every place beyond home needs a routeMap pin. Tiny ffmpeg clips carry
# the GPS tags; the home circle and the gazetteer are built per test, never read from the machine.
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import ffio, geo_proof
from zks_engine.qc import map_gates

HOME = {"lat": -33.0, "lon": 151.0, "radius_km": 9.0}  # made up: nowhere near the real home
TOKYO, OSAKA, AT_HOME = "+35.6895+139.6917/", "+34.6937+135.5023/", "-33.0010+151.0010/"


def pin(lon, lat):
    return {"kind": "routeMap", "stops": [{"name": "x", "lon": lon, "lat": lat}]}


class MapGateTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="map-gate-"))
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.gaz = self.gazetteer([(35.6895, 139.6917, "Shinjuku"), (34.6937, 135.5023, "Osaka")])

    def gazetteer(self, rows, name="cities.txt"):
        path = self.dir / name
        path.write_text("".join(f"1\t{n}\t\t\t{lat}\t{lon}\t\t\tXX\t\t\t\t\t\t0\n" for lat, lon, n in rows), encoding="utf-8")
        return geo_proof.Gazetteer(path)

    def clip(self, name, location=None):
        path = self.dir / name
        tag = ["-metadata", f"location={location}"] if location else []
        subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.2:r=10", *tag, str(path)], check=True)
        return path

    def check(self, clips, cues, places=(), gaz="default"):
        return map_gates.check(clips, list(places), cues, HOME, self.gaz if gaz == "default" else gaz)

    def test_home_only_needs_no_map(self):
        self.assertEqual(self.check([self.clip("a.mp4", AT_HOME)], []), ("PASS", "home only, no map needed"))

    def test_two_places_one_pinned_fails_naming_the_other(self):
        clips = [self.clip("a.mp4", TOKYO), self.clip("b.mp4", OSAKA)]
        self.assertEqual(self.check(clips, [pin(139.69, 35.68)]), ("FAIL", "Osaka not pinned"))

    def test_every_place_pinned_passes(self):
        clips = [self.clip("a.mp4", TOKYO), self.clip("b.mp4", OSAKA)]
        self.assertEqual(self.check(clips, [pin(139.69, 35.68), pin(135.5, 34.69)]), ("PASS", "2 places, 2 pinned"))

    def test_a_declared_place_covers_a_clip_without_gps(self):
        clips, bohol = [self.clip("a.mp4")], [{"name": "Bohol", "lon": 123.85, "lat": 9.65}]
        self.assertEqual(self.check(clips, [], bohol), ("FAIL", "Bohol not pinned"))
        self.assertEqual(self.check(clips, [pin(123.9, 9.7)], bohol), ("PASS", "1 places, 1 pinned"))

    def test_a_pin_within_25_km_counts_and_36_km_does_not(self):
        clips = [self.clip("a.mp4", TOKYO)]
        self.assertEqual(self.check(clips, [pin(139.69 + 0.2, 35.69)])[0], "PASS")  # ~18 km
        self.assertEqual(self.check(clips, [pin(139.69 + 0.4, 35.69)])[0], "FAIL")  # ~36 km

    def test_without_a_gazetteer_a_gps_cluster_is_an_unnamed_place_that_needs_a_pin(self):
        status, line = self.check([self.clip("a.mp4", TOKYO)], [], gaz=None)
        self.assertEqual(status, "FAIL")
        self.assertIn("place near 35.7,139.7 not pinned", line)
        self.assertIn("WARN no gazetteer", line)

    def test_a_geotag_name_maps_to_the_name_viewers_know(self):
        gaz = self.gazetteer([(9.65, 123.85, "Dauis")], "bohol.txt")
        self.assertEqual(self.check([self.clip("a.mp4", "+9.6500+123.8500/")], [], gaz=gaz), ("FAIL", "Bohol not pinned"))

    def test_no_gps_and_no_declared_places_is_a_warning_that_passes(self):
        status, line = self.check([self.clip("a.mp4")], [])
        self.assertEqual(status, "WARN")
        self.assertIn("carry no GPS", line)

    def test_the_output_never_prints_home_coordinates(self):
        line = self.check([self.clip("a.mp4", AT_HOME)], [])[1]
        self.assertNotIn("33.0", line)
        self.assertNotIn("151.0", line)

    def test_a_missing_ffprobe_is_an_error_not_no_gps(self):
        clip = self.clip("a.mp4", TOKYO)
        with mock.patch.object(geo_proof.subprocess, "run", side_effect=FileNotFoundError("ffprobe")), self.assertRaisesRegex(RuntimeError, "ffprobe"):
            geo_proof.gps_points(clip)

    def test_pins_come_from_routeMap_stops_only(self):
        cues = [pin(1, 2), {"kind": "bigWord", "stops": [{"lon": 5, "lat": 6}]}]
        self.assertEqual(map_gates.pins_of(cues), [[1, 2]])

    def test_a_gate_failure_is_a_problem_and_a_warning_passes_with_its_line(self):
        with mock.patch.object(map_gates, "check", return_value=("FAIL", "Osaka not pinned")):
            self.assertEqual(map_gates.map_problems([], [], []), (["Osaka not pinned"], "Osaka not pinned"))
        with mock.patch.object(map_gates, "check", return_value=("WARN", "1 source(s) carry no GPS")):
            self.assertEqual(map_gates.map_problems([], [], []), ([], "1 source(s) carry no GPS"))


class CoverTests(unittest.TestCase):
    EDL = {"fps_num": 30000, "fps_den": 1001, "frames": 300, "segments": [{"in": 0, "out": 300, "target": 0}]}

    def test_a_full_frame_map_covers_the_footage_and_an_inset_does_not(self):
        from zks_engine.qc import inputs

        full = {"kind": "routeMap", "at": 1.0, "end": 3.0, "full": True, "region": "asia", "stops": []}
        inset = {**full, "full": False}
        self.assertEqual(len(inputs.cover_spans([full], self.EDL)), 1)
        self.assertEqual(inputs.cover_spans([inset], self.EDL), [])


if __name__ == "__main__":
    unittest.main()
