# Created by The Angelo Umali.
# §7.6 traps as gates: each fails the job with a message naming what to fix.
import tempfile
import unittest
from pathlib import Path

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine.specs import gates
from zks_engine.specs.gates import GateFailed


class GraphGateTests(unittest.TestCase):
    def test_setpts_n_times_is_rejected(self):
        with self.assertRaisesRegex(GateFailed, "setpts=N\\*"):
            gates.check_graph("[0:v]select=eq(n\\,3),setpts=N*1001[v]")

    def test_restamp_in_its_own_time_base_passes(self):
        gates.check_graph("[0:v]settb=1001/30000,setpts=N[v]")

    def test_mixed_cuda_upload_and_overlay_is_rejected(self):
        with self.assertRaisesRegex(GateFailed, "hwupload_cuda"):
            gates.check_graph("[1:v]hwupload_cuda[o];[0:v][o]overlay_cuda[v]")

    def test_looping_input_needs_framerate_and_bound(self):
        with self.assertRaisesRegex(GateFailed, "-framerate"):
            gates.check_looping_inputs(["-loop", "1", "-t", "5", "-i", "veil.png"])
        with self.assertRaisesRegex(GateFailed, "bounded"):
            gates.check_looping_inputs(["-loop", "1", "-framerate", "30000/1001", "-i", "veil.png"])

    def test_bounded_looping_input_passes_and_options_reset_per_input(self):
        gates.check_looping_inputs(["-framerate", "30000/1001", "-loop", "1", "-t", "5", "-i", "veil.png", "-i", "clip.mp4"])
        with self.assertRaisesRegex(GateFailed, "veil2.png"):
            gates.check_looping_inputs(["-loop", "1", "-framerate", "30", "-t", "5", "-i", "veil.png", "-loop", "1", "-i", "veil2.png"])


class CountAndLoudnessTests(unittest.TestCase):
    def test_overlay_count_mismatch_fails(self):
        with self.assertRaisesRegex(GateFailed, "overlay"):
            gates.check_counts(edl_frames=300, overlay_frames=299, audio_samples=480480)

    def test_audio_length_must_match_the_frames(self):
        gates.check_counts(edl_frames=300, overlay_frames=300, audio_samples=480480)
        with self.assertRaisesRegex(GateFailed, "audio"):
            gates.check_counts(edl_frames=300, overlay_frames=300, audio_samples=480000)

    def test_loudness_window(self):
        gates.check_loudness(-14.4, -1.5)
        with self.assertRaisesRegex(GateFailed, "LUFS"):
            gates.check_loudness(-16.0, -2.0)
        with self.assertRaisesRegex(GateFailed, "true peak"):
            gates.check_loudness(-14.0, -0.5)


class CaptionGateTests(unittest.TestCase):
    PHRASES = [
        {"id": 0, "at": 0, "end": 1, "reel": None, "text": "a"},
        {"id": 1, "at": 1, "end": 2, "reel": 0, "text": "b"},
        {"id": 2, "at": 2, "end": 3, "reel": 0, "text": "c"},
    ]

    def test_group_crossing_a_reel_keep_edge_fails(self):
        with self.assertRaisesRegex(GateFailed, r"ids \[0, 1\] cross a Reels keep edge"):
            gates.check_captions([{"ids": [0, 1], "en": "a b"}], self.PHRASES)

    def test_group_inside_one_keep_passes(self):
        gates.check_captions([{"ids": [1, 2], "en": "b c"}, {"ids": [0], "en": "a"}], self.PHRASES)

    def test_unknown_phrase_id_fails(self):
        with self.assertRaisesRegex(GateFailed, "7"):
            gates.check_captions([{"ids": [7], "en": "x"}], self.PHRASES)

    def test_long_entry_that_wraps_to_three_lines_fails(self):
        with self.assertRaisesRegex(GateFailed, "3 lines"):
            gates.check_captions([{"ids": [0], "en": "word " * 14}], self.PHRASES)


class SnapshotTests(unittest.TestCase):
    def test_spec_change_after_snapshot_fails(self):
        folder = Path(tempfile.mkdtemp())
        spec = folder / "v1.json"
        spec.write_text("[]", encoding="utf-8")
        digest = gates.snapshot([spec])
        gates.check_snapshot([spec], digest)
        spec.write_text('[{"kind": "comment"}]', encoding="utf-8")
        with self.assertRaisesRegex(GateFailed, "changed"):
            gates.check_snapshot([spec], digest)


class PidProbeTests(unittest.TestCase):
    def test_kill_zero_probe_is_banned(self):
        with self.assertRaisesRegex(GateFailed, "os.kill"):
            gates.check_no_pid_probe("alive = os.kill(pid, 0)", "x.py")
        gates.check_no_pid_probe("os.kill(pid, signal.SIGTERM)", "x.py")

    def test_engine_source_has_no_kill_zero_probe(self):
        for path in (support.ENGINE / "zks_engine").rglob("*.py"):
            gates.check_no_pid_probe(path.read_text(encoding="utf-8"), path.name)


if __name__ == "__main__":
    unittest.main()
