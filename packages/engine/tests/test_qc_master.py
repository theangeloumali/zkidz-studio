# Created by The Angelo Umali.
# qc_master on real masters built by ffmpeg: one passing edit, and one fixture per gate that must fail it (plan §14 Phase 5).
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from support import has_ffmpeg, make_edl  # first: it sets a scratch ZKS_HOME

from zks_engine import ffio, qc
from zks_engine.pipeline import frame_to_sample
from zks_engine.qc import contrast, mouth
from zks_engine.specs.gates import GateFailed

FPS = "30000/1001"
# Frames 0-60 and 90-180 of the source: one cut at edited frame 60 (2.002 s); 150 frames in all.
EDL = make_edl([(0, 60), (90, 180)])
WORDS = [{"at": 0.4, "end": 0.8, "text": " we"}, {"at": 1.2, "end": 1.6, "text": " ship"}, {"at": 3.2, "end": 3.6, "text": " today"}]
CAPTION = {"kind": "caption", "at": 0.3, "end": 1.7, "text": "we ship", "bottom": 1430}
PLATE_INK = "0x172230"


def run(command):
    subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-nostdin", "-y", *command], check=True, timeout=120)


def make_source(path):
    """testsrc2 moves every frame; seeded white noise makes the audio offset sharp."""
    run(["-f", "lavfi", "-i", f"testsrc2=size=270x480:rate={FPS}", "-f", "lavfi", "-i", "anoisesrc=color=white:seed=1:amplitude=0.2:sample_rate=48000",
         "-t", "6.5", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "16", "-g", "10", "-c:a", "pcm_s16le", str(path)])


def make_master(source, out, slip_frames=0, band=None):
    """The EDL's segments joined frame- and sample-exact, then a fixture's one fault: audio slipped, or a band under the
    caption ('plate' is the ink plate with white strokes, 'wall' a white wall with white strokes)."""
    count = len(EDL["segments"])
    # One split per stream: two filters reading [0:v] directly deadlock ffmpeg at full CPU.
    parts = [f"[0:v]split={count}" + "".join(f"[vs{index}]" for index in range(count)),
             f"[0:a]asplit={count}" + "".join(f"[as{index}]" for index in range(count))]
    labels = ""
    for index, seg in enumerate(EDL["segments"]):
        parts.append(f"[vs{index}]trim=start_frame={seg['in']}:end_frame={seg['out']},setpts=PTS-STARTPTS[v{index}]")
        parts.append(f"[as{index}]atrim=start_sample={frame_to_sample(seg['in'], EDL)}:end_sample={frame_to_sample(seg['out'], EDL)},asetpts=PTS-STARTPTS[a{index}]")
        labels += f"[v{index}][a{index}]"
    video = "scale=1080:1920"
    if band:
        x, y, w, h = contrast.caption_box(CAPTION["bottom"])
        fill = PLATE_INK if band == "plate" else "white"
        video += f",drawbox=x={x}:y={y}:w={w}:h={h}:color={fill}:t=fill,drawbox=x={x + 60}:y={y + 50}:w=300:h=24:color=white:t=fill"
    audio = "loudnorm=I=-14:TP=-2:LRA=7,aresample=48000"
    if slip_frames:
        audio = f"adelay=delays={slip_frames * 1001 / 30:.3f}:all=1,atrim=end_sample={frame_to_sample(EDL['frames'], EDL)}," + audio
    graph = ";".join(parts) + f";{labels}concat=n={len(EDL['segments'])}:v=1:a=1[v][a];[v]{video},format=yuv420p[vo];[a]{audio}[ao]"
    run(["-i", str(source), "-filter_complex", graph, "-map", "[vo]", "-map", "[ao]", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "16",
         "-r", FPS, "-c:a", "aac", "-b:a", "256k", "-ar", "48000", str(out)])


def make_frozen(clean, out):
    """The clean master's first picture held for every frame (the ep25 fault) over its own soundtrack."""
    still = out.with_suffix(".png")
    run(["-i", str(clean), "-frames:v", "1", str(still)])
    run(["-loop", "1", "-framerate", FPS, "-t", "6", "-i", str(still), "-i", str(clean), "-map", "0:v", "-map", "1:a", "-frames:v", str(EDL["frames"]),
         "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "copy", str(out)])


def write_rgba_png(pixels, path):
    """One RGBA PNG from an array; drawbox leaves alpha untouched, so the card is written pixel by pixel."""
    subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-nostdin", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", "1080x1920", "-i", "-",
                    "-frames:v", "1", str(path)], input=pixels.tobytes(), check=True, timeout=60)


def make_overlay(frames_dir, count, cover_mouth_from=None):
    """Transparent 1080x1920 overlay frames; optionally an opaque card over the mouth box from that frame on."""
    frames_dir.mkdir(parents=True, exist_ok=True)
    clear = np.zeros((1920, 1080, 4), np.uint8)
    write_rgba_png(clear, frames_dir / "clear.png")
    card = clear.copy()
    x, y, w, h = mouth.MOUTH_BOX
    card[y:y + h, x:x + w] = (200, 40, 40, 255)
    write_rgba_png(card, frames_dir / "card.png")
    for frame in range(count):
        covered = cover_mouth_from is not None and frame >= cover_mouth_from
        shutil.copyfile(frames_dir / ("card.png" if covered else "clear.png"), frames_dir / f"{frame:05d}.png")


def fake_transcriber(heard):
    """Stands in for whisper.cpp, which the scratch ZKS_HOME does not hold: every window hears these words."""
    return lambda master, start_s, end_s: [{"text": f" {word}"} for word in heard]


@unittest.skipUnless(has_ffmpeg(), "needs ffmpeg")
class QcMasterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = Path(tempfile.mkdtemp(prefix="zks-qc-"))
        cls.source = cls.folder / "media" / "source.mkv"
        cls.source.parent.mkdir()
        make_source(cls.source)
        cls.masters = {}
        for name, faults in {"clean": {"band": "plate"}, "slip": {"slip_frames": 1, "band": "plate"}, "wall": {"band": "wall"}}.items():
            cls.masters[name] = cls.folder / f"{name}.mp4"
            make_master(cls.source, cls.masters[name], **faults)
        cls.masters["frozen"] = cls.folder / "frozen.mp4"
        make_frozen(cls.masters["clean"], cls.masters["frozen"])

    def setUp(self):
        self.work = Path(tempfile.mkdtemp(prefix="work-", dir=self.folder))
        for sub, body in (("edl", EDL), ("cuts", {"source": "media/source.mkv", "facecam": []}), ("cues", [CAPTION])):
            (self.work / sub).mkdir()
            (self.work / sub / "v1.json").write_text(json.dumps(body), encoding="utf-8")
        make_overlay(self.work / "frames" / "v1", 75)
        self.patch = mock.patch("zks_engine.qc.inputs.WORK", self.work)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def run_qc(self, master="clean", heard=("we", "ship", "today"), words=WORDS):
        return qc.qc_master("v1", self.masters[master], self.source, words, fake_transcriber(heard))

    def failed(self, report):
        return {check["name"] for check in report["checks"] if not check["ok"]}

    def test_the_clean_master_passes_every_gate(self):
        report = self.run_qc()
        self.assertEqual(self.failed(report), set(), report)
        self.assertTrue(report["ok"])
        self.assertEqual({check["name"] for check in report["checks"]},
                         {"format", "frames", "loudness", "motion", "cutWords", "captionContrast", "hookMouth", "lipSync"})

    def test_a_word_clipped_at_a_cut_fails(self):
        clipped = [*WORDS[:2], {"at": 1.9, "end": 3.1, "text": " clipped"}]
        report = self.run_qc(words=clipped)
        self.assertEqual(self.failed(report), {"cutWords"})

    def test_a_word_the_master_lost_at_a_cut_fails(self):
        self.assertEqual(self.failed(self.run_qc(heard=("we", "today"))), {"cutWords"})

    def test_a_white_caption_on_a_white_wall_fails(self):
        self.assertEqual(self.failed(self.run_qc("wall")), {"captionContrast"})

    def test_a_cue_over_the_mouth_at_one_second_fails(self):
        make_overlay(self.work / "frames" / "v1", 75, cover_mouth_from=30)
        report = self.run_qc()
        self.assertEqual(self.failed(report), {"hookMouth"})
        self.assertIn("1.00 s", next(check["detail"] for check in report["checks"] if check["name"] == "hookMouth"))

    def test_a_one_frame_audio_slip_fails(self):
        self.assertEqual(self.failed(self.run_qc("slip")), {"lipSync"})

    def test_frozen_footage_fails_the_motion_gate_and_blocks_export(self):
        report = self.run_qc("frozen")
        self.assertIn("motion", self.failed(report))
        with self.assertRaisesRegex(GateFailed, "motion"):
            qc.assert_exportable("v1")

    def deliver(self, master="clean"):
        """The master as render_master leaves it in out/, QC'd there."""
        (self.work / "out").mkdir(exist_ok=True)
        delivered = self.work / "out" / "v1.mp4"
        shutil.copyfile(self.masters[master], delivered)
        qc.qc_master("v1", delivered, self.source, WORDS, fake_transcriber(("we", "ship", "today")))
        return delivered

    def test_a_passing_report_allows_export(self):
        self.deliver()
        qc.assert_exportable("v1")

    def test_a_master_rendered_after_its_passing_qc_is_blocked(self):
        delivered = self.deliver()
        shutil.copyfile(self.masters["frozen"], delivered)
        with self.assertRaisesRegex(GateFailed, "stale; rerun qc_master"):
            qc.assert_exportable("v1")

    def test_a_newer_master_of_another_quality_is_blocked(self):
        delivered = self.deliver()
        newer = delivered.with_name("v1-4k.mp4")
        shutil.copyfile(delivered, newer)
        stamp = delivered.stat().st_mtime_ns + 5_000_000_000
        os.utime(newer, ns=(stamp, stamp))
        with self.assertRaisesRegex(GateFailed, "stale; rerun qc_master"):
            qc.assert_exportable("v1")

    def test_export_without_a_qc_report_is_blocked(self):
        with self.assertRaisesRegex(GateFailed, "qc_master"):
            qc.assert_exportable("v1")

    def test_check_motion_scores_every_shot_against_the_source(self):
        frozen = qc.check_motion_master("v1", self.masters["frozen"], self.source)
        self.assertEqual(frozen["verdict"], "FAIL")
        self.assertTrue(all(shot["isFrozen"] for shot in frozen["shots"]))
        clean = qc.check_motion_master("v1", self.masters["clean"], self.source)
        self.assertEqual(clean["verdict"], "PASS")
        self.assertEqual(len(clean["shots"]), 2)

    def test_a_shot_frozen_in_any_region_fails(self):
        regions = [(240, 880, 600, 380), (0, 0, 1080, 400)]
        self.assertEqual(qc.check_motion_master("v1", self.masters["frozen"], self.source, regions)["verdict"], "FAIL")
        clean = qc.check_motion_master("v1", self.masters["clean"], self.source, regions)
        self.assertEqual((clean["verdict"], len(clean["shots"])), ("PASS", 2))

    def test_check_motion_on_the_source_compares_each_joined_clip(self):
        result = qc.check_motion_source(self.source, [(self.source, 0.0)], [(240, 880, 600, 380)])
        self.assertEqual(result["verdict"], "PASS")


if __name__ == "__main__":
    unittest.main()
