# Created by The Angelo Umali.
# qc_master (plan §7.6): every gate runs on the finished master and reports; none stops at the first failure.
# The report lands in work/qc/<video>.json, and export refuses a video whose last report failed.
import json
import tempfile
from pathlib import Path

from ..specs.gates import GateFailed
from ..transcribe import whispercpp
from . import inputs, master_gates, media, words
from .motion_check import check_motion_master, check_motion_source, motion_problems

__all__ = ["assert_exportable", "check_motion_master", "check_motion_source", "latest_master", "qc_master", "whisper_transcriber"]

MASTER_SUFFIXES = ("-4k", "", "-draft")


def latest_master(video):
    found = [path for suffix in MASTER_SUFFIXES if (path := inputs.work() / "out" / f"{video}{suffix}.mp4").exists()]
    if not found:
        raise GateFailed(f"{video} has no master in out/; run render_master first")
    return max(found, key=lambda path: path.stat().st_mtime)


def master_fingerprint(master):
    """Which file a report judged: a re-render after QC changes it, and export must not ride the old PASS."""
    stat = Path(master).stat()
    return {"name": Path(master).name, "bytes": stat.st_size, "mtimeNs": stat.st_mtime_ns}


def whisper_transcriber(language="auto", model=None):
    """Re-transcribes a stretch of the master with the pinned whisper.cpp (plan §7.4)."""
    model_file = whispercpp.model_path(model)

    def transcribe(master, start_s, end_s):
        with tempfile.TemporaryDirectory(prefix="zks-qc-") as scratch:
            wav = Path(scratch) / "window.wav"
            media.write_wav(wav, master, start_s, end_s - start_s)
            return whispercpp.transcribe_file(wav, language, model_file, 1)

    return transcribe


def qc_master(video, master, source, transcript_words, transcribe):
    """transcript_words: [{at, end, text}] in source seconds; transcribe(master, start_s, end_s) -> words heard there."""
    edl, spec, intro = inputs.load_edl(video), inputs.load_spec(video), inputs.intro_of(video)
    gates_to_run = {
        "format": lambda: master_gates.format_problems(master),
        "frames": lambda: master_gates.frame_problems(master, edl, intro),
        "loudness": lambda: master_gates.loudness_problems(master),
        "motion": lambda: motion_problems(video, master, source),
        "cutWords": lambda: words.cut_word_problems(transcript_words, edl, intro, lambda start_s, end_s: transcribe(master, start_s, end_s)),
        "captionContrast": lambda: master_gates.caption_problems(video, master, edl, intro),
        "hookMouth": lambda: master_gates.mouth_problems(video, edl, intro, spec),
        "lipSync": lambda: master_gates.lip_sync_problems(master, source, edl, intro),
    }
    checks = []
    for name, run_gate in gates_to_run.items():
        problems = run_gate()
        checks.append({"name": name, "ok": not problems, "detail": "; ".join(problems) or "pass"})
    report = {"ok": all(check["ok"] for check in checks), "checks": checks}
    (inputs.work() / "qc").mkdir(exist_ok=True)
    (inputs.work() / "qc" / f"{video}.json").write_text(json.dumps({"master": Path(master).name, "fingerprint": master_fingerprint(master), **report}, indent=2), encoding="utf-8")
    return report


def assert_exportable(video):
    """Delivery is blocked until the latest master passed every gate, the moving-footage gate above all."""
    report = inputs.read_json(inputs.work() / "qc" / f"{video}.json")
    if report is None:
        raise GateFailed(f"{video} has no QC report; run qc_master before export")
    if failed := [check["name"] for check in report["checks"] if not check["ok"]]:
        raise GateFailed(f"{video} failed QC ({', '.join(failed)}); fix it and re-render before export")
    if report.get("fingerprint") != master_fingerprint(latest_master(video)):
        raise GateFailed(f"{video}'s QC report is stale; rerun qc_master on the latest master")
