# Created by The Angelo Umali.
# Which file QC judged, from which source and spec snapshot: the Phase 5 security review's repros as tests.
import hashlib
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from support import has_ffmpeg  # first: it sets a scratch ZKS_HOME

import test_qc_master as fixtures
from zks_engine import cli, pipeline, qc
from zks_engine.render import commands
from zks_engine.specs.gates import GateFailed

HEARD = ("we", "ship", "today")


def sha256_of(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


@unittest.skipUnless(has_ffmpeg(), "needs ffmpeg")
class QcProvenanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = Path(tempfile.mkdtemp(prefix="zks-qc-prov-"))
        cls.source = cls.folder / "media" / "source.mkv"
        cls.source.parent.mkdir()
        fixtures.make_source(cls.source)
        cls.clean = cls.folder / "clean.mp4"
        fixtures.make_master(cls.source, cls.clean, band="plate")
        cls.wall = cls.folder / "wall.mp4"
        fixtures.make_master(cls.source, cls.wall, band="wall")
        cls.frozen = cls.folder / "frozen.mp4"
        fixtures.make_frozen(cls.clean, cls.frozen)
        # A source that never moves: judged against it, frozen footage looks like the original.
        cls.still_source = cls.folder / "media" / "still.mp4"
        shutil.copyfile(cls.frozen, cls.still_source)

    def setUp(self):
        self.work = Path(tempfile.mkdtemp(prefix="work-", dir=self.folder))
        for sub, body in (("edl", fixtures.EDL), ("cuts", {"source": "media/source.mkv", "facecam": []}), ("cues", [fixtures.CAPTION])):
            (self.work / sub).mkdir()
            (self.work / sub / "v1.json").write_text(json.dumps(body), encoding="utf-8")
        fixtures.make_overlay(self.work / "frames" / "v1", 75)
        (self.work / "out").mkdir()
        for patcher in (mock.patch("zks_engine.qc.inputs.WORK", self.work), mock.patch.object(pipeline, "WORK", self.work)):
            patcher.start()
            self.addCleanup(patcher.stop)

    def put_master(self, master=None):
        delivered = self.work / "out" / "v1.mp4"
        shutil.copyfile(master or self.clean, delivered)
        return delivered

    def snapshot(self, cues):
        folder = self.work / "snapshots" / "abc123"
        (folder / "cues").mkdir(parents=True)
        (folder / "cuts").mkdir()
        (folder / "cues" / "v1.json").write_text(json.dumps(cues), encoding="utf-8")
        (folder / "cuts" / "v1.json").write_text(json.dumps({"source": "media/source.mkv", "facecam": []}), encoding="utf-8")
        return folder

    def run_cli_qc(self, source, specs="snapshots/abc123"):
        args = cli.parser().parse_args(["qc-master", "--video", "v1", "--master", "out/v1.mp4", "--source", os.path.relpath(source, self.work),
                                        "--specs", specs, "--words", str(self.words_file()), "--json"])
        with mock.patch.object(qc, "whisper_transcriber", return_value=fixtures.fake_transcriber(HEARD)), mock.patch.dict(os.environ):
            os.environ.pop("ZKS_SPECS", None)
            return commands.qc_master_payload(args)

    def words_file(self):
        path = self.work / "words.json"
        path.write_text(json.dumps(fixtures.WORDS), encoding="utf-8")
        return path

    def failed(self, report):
        return {check["name"] for check in report["checks"] if not check["ok"]}

    # Kai qc_race.py: a render that lands while the gates run was credited with the PASS of the file before it.
    def test_a_master_rewritten_while_the_gates_run_fails_qc(self):
        delivered = self.put_master()
        judged_sha = sha256_of(delivered)
        landed = []

        def transcribe_then_rerender(master, start_s, end_s):
            if not landed:
                shutil.copyfile(self.frozen, delivered)
                os.utime(delivered, ns=(delivered.stat().st_mtime_ns + 10_000_000, delivered.stat().st_mtime_ns + 10_000_000))
                landed.append(True)
            return [{"text": f" {word}"} for word in HEARD]

        report = qc.qc_master("v1", delivered, self.source, fixtures.WORDS, transcribe_then_rerender)
        self.assertFalse(report["ok"])
        self.assertEqual(report["reason"], "master changed during QC")
        self.assertIn("master", self.failed(report))
        self.assertEqual(report["master"]["sha256"], judged_sha)
        with self.assertRaises(GateFailed):
            qc.assert_exportable("v1")

    # Kai static_source.py: QC judged the master against whatever source the cut spec named after the render.
    def test_qc_against_another_source_than_the_render_used_fails(self):
        self.put_master(self.frozen)
        (self.work / "edl" / "v1.source.json").write_text(json.dumps({"source": str(self.source.resolve())}), encoding="utf-8")
        self.snapshot([fixtures.CAPTION])
        report = self.run_cli_qc(self.still_source)
        self.assertFalse(report["ok"])
        self.assertIn("renderSource", self.failed(report))

    def test_qc_reads_the_renders_spec_snapshot_and_records_what_it_judged(self):
        delivered = self.put_master(self.wall)
        (self.work / "edl" / "v1.source.json").write_text(json.dumps({"source": str(self.source.resolve())}), encoding="utf-8")
        self.snapshot([])  # the render drew no caption; the live sheet's caption over the white wall was added after it
        report = self.run_cli_qc(self.source)
        self.assertNotIn("captionContrast", self.failed(report))
        stats = delivered.stat()
        self.assertEqual(report["master"], {"relPath": "out/v1.mp4", "size": stats.st_size, "mtimeNs": str(stats.st_mtime_ns), "sha256": sha256_of(delivered)})
        self.assertEqual(report["source"], {"relPath": "media/source.mkv"})  # project-relative, as the server names assets
        self.assertEqual(report["specsSnapshot"], "snapshots/abc123")
        saved = json.loads((self.work / "qc" / "v1.json").read_text(encoding="utf-8"))
        self.assertEqual((saved["master"], saved["source"], saved["specsSnapshot"]), (report["master"], report["source"], "snapshots/abc123"))

    def test_qc_refuses_a_snapshot_outside_the_snapshots_folder(self):
        self.put_master()
        with self.assertRaisesRegex(GateFailed, "snapshot"):
            self.run_cli_qc(self.source, specs="cuts")

    def test_qc_status_names_the_judged_master_source_and_snapshot(self):
        delivered = self.put_master()
        (self.work / "edl" / "v1.source.json").write_text(json.dumps({"source": str(self.source.resolve())}), encoding="utf-8")
        self.snapshot([fixtures.CAPTION])
        report = self.run_cli_qc(self.source)
        self.assertTrue(report["ok"], report)
        verdict = qc.assert_exportable("v1")
        self.assertEqual(verdict, {"master": report["master"], "source": report["source"], "specsSnapshot": "snapshots/abc123"})
        self.assertEqual(verdict["master"]["sha256"], sha256_of(delivered))

    # Kai mtime_forge.py: other bytes at the same size, with the mtime set back, rode the old PASS.
    def test_a_master_forged_to_the_judged_size_and_mtime_is_blocked(self):
        delivered = self.put_master()
        qc.qc_master("v1", delivered, self.source, fixtures.WORDS, fixtures.fake_transcriber(HEARD))
        qc.assert_exportable("v1")
        stats = delivered.stat()
        with delivered.open("r+b") as forged:
            forged.seek(stats.st_size // 2)
            byte = forged.read(1)
            forged.seek(stats.st_size // 2)
            forged.write(bytes([byte[0] ^ 0xFF]))
        os.utime(delivered, ns=(stats.st_atime_ns, stats.st_mtime_ns))
        self.assertEqual((delivered.stat().st_size, delivered.stat().st_mtime_ns), (stats.st_size, stats.st_mtime_ns))
        with self.assertRaisesRegex(GateFailed, "stale"):
            qc.assert_exportable("v1")


if __name__ == "__main__":
    unittest.main()
