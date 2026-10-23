# Created by The Angelo Umali.
# check_motion on the master (each shot against its source frames) and on the source (each joined clip against its original).
from .. import ffio
from . import inputs, media, motion, timeline


def shot_report(seg, rate, reference, actual):
    return {"at": seg["in"] / rate, "end": seg["out"] / rate, "score": actual["structural"], "originalScore": reference["structural"],
            "isFrozen": motion.is_frozen(reference, actual)}


def verdict(shots):
    return {"verdict": "FAIL" if any(shot["isFrozen"] for shot in shots) else "PASS", "shots": shots}


def sample(path, first_frame, fps, region):
    return motion.motion_stats(media.gray_frames(path, first_frame, motion.SAMPLES, fps, region, motion.STRIDE))


def check_regions(check, regions):
    """check(region) per region; a shot frozen in any region fails, and it reports its least-moving region's scores."""
    per_region = [check(region) for region in regions]
    shots = []
    for versions in zip(*per_region):
        frozen = [shot for shot in versions if shot["isFrozen"]]
        shots.append(min(frozen or versions, key=lambda shot: shot["score"] / max(shot["originalScore"], 0.001)))
    return verdict(shots)


def check_motion_master(video, master, source, regions=(motion.SUBJECT_REGION,)):
    return check_regions(lambda region: master_shots(video, master, source, region), regions)


def check_motion_source(source, clips, regions=(motion.SUBJECT_REGION,)):
    return check_regions(lambda region: source_shots(source, clips, region), regions)


def master_shots(video, master, source, region):
    """Each shot of the master against the same source frames, sampled a third of the way in."""
    edl = inputs.load_edl(video)
    intro, fps, rate = inputs.intro_of(video), inputs.fps_of(edl), timeline.rate(edl)
    shots = []
    for seg in motion.shots(edl):
        offset = motion.sample_offset(seg["out"] - seg["in"])
        reference = sample(source, seg["in"] + offset, fps, region)
        actual = sample(master, timeline.master_frame(seg["target"] + offset, intro), fps, region)
        shots.append(shot_report(seg, rate, reference, actual))
    return shots


def source_shots(source, clips, region):
    """The joined source against each original clip, given as (path, source second where it starts)."""
    probed = ffio.probe(source)
    fps = (probed["fps"]["num"], probed["fps"]["den"])
    rate = fps[0] / fps[1]
    starts = [round(at * rate) for _, at in clips] + [round(probed["durationS"] * rate)]
    shots = []
    for (clip, _), first, last in zip(clips, starts, starts[1:]):
        offset = motion.sample_offset(last - first)
        shots.append(shot_report({"in": first, "out": last}, rate, sample(clip, offset, fps, region), sample(source, first + offset, fps, region)))
    return shots


def motion_problems(video, master, source):
    frozen = [shot for shot in check_motion_master(video, master, source)["shots"] if shot["isFrozen"]]
    return [f"footage frozen in the shot at {shot['at']:.2f}-{shot['end']:.2f} s while the original moves" for shot in frozen]
