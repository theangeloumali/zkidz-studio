# Created by The Angelo Umali.
# qc_master (plan §7.6): every gate runs on the finished master and reports; none stops at the first failure.
# The report lands in work/qc/<video>.json, and export refuses a video whose last report failed.
import json
import os
import tempfile
from pathlib import Path

from .. import check_windows
from ..specs.gates import GateFailed
from ..transcribe import whispercpp
from . import inputs, master_gates, media, words
from .motion_check import check_motion_master, check_motion_source, motion_problems

__all__ = ["assert_exportable", "check_motion_master", "check_motion_source", "latest_master", "qc_master", "whisper_transcriber"]

MASTER_SUFFIXES = ("-4k", "", "-draft")
MASTER_CHANGED = "master changed during QC"


def latest_master(video):
    found = [path for suffix in MASTER_SUFFIXES if (path := inputs.work() / "out" / f"{video}{suffix}.mp4").exists()]
    if not found:
        raise GateFailed(f"{video} has no master in out/; run render_master first")
    return max(found, key=lambda path: path.stat().st_mtime)


def master_record(master, work_dir=None):
    """The exact file a report judged, by its bytes: size and mtime alone can be set back over other content."""
    path = Path(master).resolve()
    stat = path.stat()
    return {"relPath": work_relative(path, work_dir), "size": stat.st_size, "mtimeNs": str(stat.st_mtime_ns), "sha256": inputs.file_sha256(path)}


def work_relative(path, work_dir=None):
    return Path(os.path.relpath(Path(path).resolve(), Path(work_dir or inputs.work()).resolve())).as_posix()


def project_relative(path):
    """How the server names an asset (media/raw/x.mp4, work/sources/v1.mkv); an in-place file outside the project keeps its realpath."""
    resolved, root = Path(path).resolve(), inputs.work().resolve().parent
    return resolved.relative_to(root).as_posix() if root in resolved.parents else resolved.as_posix()


def render_source_problems(video, source):
    """The edit stage records the source each render cut from; QC against any other file judges motion on the wrong footage."""
    owner = (inputs.load_edl(video) or {}).get("base", video)
    record = inputs.read_json(inputs.work() / "edl" / f"{owner}.source.json")
    if record is None or Path(record["source"]).resolve() == Path(source).resolve():
        return []
    return [f"QC source {project_relative(source)} is not the source the master was rendered from ({project_relative(record['source'])})"]


def whisper_transcriber(language="auto", model=None):
    """Re-transcribes a stretch of the master with the pinned whisper.cpp (plan §7.4)."""
    model_file = whispercpp.model_path(model)

    def transcribe(master, start_s, end_s):
        with tempfile.TemporaryDirectory(prefix="zks-qc-") as scratch:
            wav = Path(scratch) / "window.wav"
            media.write_wav(wav, master, start_s, end_s - start_s)
            # Windows are heard one at a time.
            return whispercpp.transcribe_file(wav, language, model_file)

    return transcribe


def source_hearing(language="auto", model=None):
    """Hears a stretch of an ingested source wav alone (check_windows), in source seconds: the cutWords gate's second
    opinion on a word the long-form transcript's drifted times flag."""
    def hear(wav, start_s, end_s):
        return whispercpp.in_seconds(check_windows.transcribe(wav, max(0.0, start_s), end_s, language, model))

    return hear


def qc_master(video, master, source, transcript_words, transcribe, specs_snapshot=None, recorded_inputs=None, hear_source=None):
    """transcript_words: [{at, end, text}] in source seconds; transcribe(master, start_s, end_s) -> words heard there;
    hear_source(wav, start_s, end_s) -> words heard alone in the source (source_hearing).
    The master is fingerprinted before the gates and again after: a render landing mid-QC must not inherit the PASS.
    recorded_inputs: the render's render_inputs; None (no render to compare with) leaves the renderInputs check out."""
    judged = master_record(master)
    live_inputs = inputs.render_inputs(video)
    edl, spec, intro = inputs.load_edl(video), inputs.load_spec(video), inputs.intro_of(video)
    gates_to_run = {
        "format": lambda: master_gates.format_problems(master),
        "frames": lambda: master_gates.frame_problems(master, edl, intro),
        "loudness": lambda: master_gates.loudness_problems(master),
        "motion": lambda: motion_problems(video, master, source),
        "cutWords": lambda: words.cut_word_problems(
            transcript_words, edl, intro, lambda start_s, end_s: transcribe(master, start_s, end_s),
            hear_source and (lambda start_s, end_s: hear_source(f"audio/{edl['base']}.wav", start_s, end_s))),
        "captionContrast": lambda: master_gates.caption_problems(video, master, edl, intro),
        "hookMouth": lambda: master_gates.mouth_problems(video, edl, intro, spec),
        "lipSync": lambda: master_gates.lip_sync_problems(master, source, edl, intro),
        "renderSource": lambda: render_source_problems(video, source),
        # Last, so it also sees a rewrite while the gates above read those files.
        **({} if recorded_inputs is None else {
            "renderInputs": lambda: inputs.render_input_problems(recorded_inputs, live_inputs) or
            inputs.render_input_problems(recorded_inputs, inputs.render_inputs(video))}),
    }
    checks = []
    for name, run_gate in gates_to_run.items():
        problems = run_gate()
        checks.append({"name": name, "ok": not problems, "detail": "; ".join(problems) or "pass"})
    unchanged = Path(master).exists() and master_record(master) == judged
    checks.append({"name": "master", "ok": unchanged, "detail": "pass" if unchanged else MASTER_CHANGED})
    report = {"ok": all(check["ok"] for check in checks), **({} if unchanged else {"reason": MASTER_CHANGED}), "checks": checks,
              "master": judged, "source": {"relPath": project_relative(source)}, "specsSnapshot": specs_snapshot,
              **({} if recorded_inputs is None else {"renderInputs": live_inputs})}
    (inputs.work() / "qc").mkdir(exist_ok=True)
    (inputs.work() / "qc" / f"{video}.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def assert_exportable(video):
    """Delivery is blocked until the latest master passed every gate, the moving-footage gate above all; returns the exact
    master, source and spec snapshot that report judged."""
    report = inputs.read_json(inputs.work() / "qc" / f"{video}.json")
    if report is None:
        raise GateFailed(f"{video} has no QC report; run qc_master before export")
    if failed := [check["name"] for check in report["checks"] if not check["ok"]]:
        raise GateFailed(f"{video} failed QC ({', '.join(failed)}); fix it and re-render before export")
    judged = report.get("master")
    master = inputs.work() / judged["relPath"] if isinstance(judged, dict) else None
    if master is None or not master.is_file() or master.resolve() != latest_master(video).resolve() or master_record(master) != judged:
        raise GateFailed(f"{video}'s QC report is stale; rerun qc_master on the latest master")
    return {"master": judged, "source": report["source"], "specsSnapshot": report["specsSnapshot"]}
