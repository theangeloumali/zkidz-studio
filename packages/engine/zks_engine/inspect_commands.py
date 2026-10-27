# Created by The Angelo Umali.
# The agent's look-before-cut commands: check-window, energy-profile and caption-phrases, each one JSON report.
# Times are source seconds; paths are work-relative.
import json

from . import captions, check_windows, edl
from .pipeline import ENERGY_WINDOW, WORK, load_energy, spec_file
from .specs import SpecError
from .specs.paths import video_id
from .transcribe import whispercpp

MAX_RANGES, MAX_RANGE_S = 8, 10.0
MAX_PROFILE_S = 30.0
QUIET_DB, QUIET_MIN_S = -35.0, 0.25  # used when the cut spec has no trimPauses


def ingested_audio(video):
    wav = f"audio/{video}.wav"
    if not (WORK / wav).exists():
        raise SpecError(f"no {wav}: ingest {video} first")
    return wav


def parse_range(text):
    try:
        start, end = (float(part) for part in text.split("-"))
    except ValueError as error:
        raise SpecError(f"--range {text!r} is not START-END in seconds") from error
    if end <= start:
        raise SpecError(f"--range {text}: end must be after start")
    if end - start > MAX_RANGE_S:
        raise SpecError(f"--range {text} is longer than {MAX_RANGE_S:g} s")
    return start, end


def check_window_payload(args):
    video = video_id(args.video)
    if len(args.range) > MAX_RANGES:
        raise SpecError(f"{len(args.range)} ranges: at most {MAX_RANGES} per call")
    spans = [parse_range(text) for text in args.range]
    wav = ingested_audio(video)
    results = check_windows.transcribe_all(wav, spans, args.language, args.model)
    return {"windows": [{"at": start, "end": end, "words": whispercpp.in_seconds(words)} for (start, end), words in zip(spans, results)]}


def quiet_settings(video):
    """The cut spec's trimPauses threshold and minimum, so the runs shown are the ones a trim would remove."""
    path = spec_file(WORK, f"cuts/{video}.json")
    trim = json.loads(path.read_text(encoding="utf-8")).get("trimPauses") if path.is_file() else None
    return (trim["thresholdDb"], trim["minS"]) if trim else (QUIET_DB, QUIET_MIN_S)


def quiet_runs(levels, first, threshold_db, min_s):
    """Runs below the threshold lasting at least min_s, in source seconds; `first` is the window index levels[0] sits at."""
    return [{"at": round((first + start) * ENERGY_WINDOW, 3), "end": round((first + end) * ENERGY_WINDOW, 3)}
            for start, end in edl.quiet_runs(levels, threshold_db) if (end - start) * ENERGY_WINDOW >= min_s - 1e-9]


def energy_profile_payload(args):
    video = video_id(args.video)
    if args.to <= args.from_:
        raise SpecError("--to must be after --from")
    if args.to - args.from_ > MAX_PROFILE_S:
        raise SpecError(f"a profile window is at most {MAX_PROFILE_S:g} s")
    first, last = round(args.from_ / ENERGY_WINDOW), round(args.to / ENERGY_WINDOW)
    levels = load_energy(WORK / ingested_audio(video))[first:last]
    return {"stepMs": round(ENERGY_WINDOW * 1000), "db": [round(float(db), 1) for db in levels],
            "quietRuns": quiet_runs(levels, first, *quiet_settings(video))}


def caption_phrases_payload(args):
    video = video_id(args.video)
    if not captions.transcript_path(video).exists():
        raise SpecError(f"no transcripts/{video}.words.json: transcribe {video} first")
    if not spec_file(WORK, f"cuts/{video}.json").is_file():
        raise SpecError(f"no cuts/{video}.json yet: call set_cuts first")
    reel = f"reels/{video}.json" if args.reel else None
    if reel and not spec_file(WORK, reel).is_file():
        raise SpecError(f"--reel: no {reel}")
    return {"phrases": captions.build_phrases(video, reel)}  # also written to captions/<v>.phrases.json, which set_captions reads


def register(commands):
    window = commands.add_parser("check-window", help="whisper each short source range on its own (silence-padded)")
    window.add_argument("--range", action="append", required=True,
                        help=f"START-END in source seconds, at most {MAX_RANGE_S:g} s; repeat up to {MAX_RANGES} times")
    window.add_argument("--language", default="auto")
    window.add_argument("--model", help="a pinned whisper model or alias; the best installed one when omitted")
    window.set_defaults(handler=check_window_payload)
    energy = commands.add_parser("energy-profile", help="audio level in 10 ms steps and the quiet runs a pause trim would cut")
    energy.add_argument("--from", dest="from_", type=float, required=True, help="source seconds")
    energy.add_argument("--to", type=float, required=True, help=f"source seconds, at most {MAX_PROFILE_S:g} s after --from")
    energy.set_defaults(handler=energy_profile_payload)
    phrases = commands.add_parser("caption-phrases", help="kept speech as timed phrases -> captions/<video>.phrases.json")
    phrases.add_argument("--reel", action="store_true", help="tag each phrase with its keep in reels/<video>.json")
    phrases.set_defaults(handler=caption_phrases_payload)
    for command in (window, energy, phrases):
        command.add_argument("--video", required=True)
        command.add_argument("--json", action="store_true", required=True, help="print JSON (the only output format)")
