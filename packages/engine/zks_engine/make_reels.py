# Created by The Angelo Umali.
# Writes a Reels cut spec: the full edit's cut spec narrowed to hand-picked keep ranges, still in source order.
# Usage (from the work dir): python -m zks_engine.make_reels v4 reels/v4.json   (reads cuts/v4.json, writes derived/cuts/v4r.json)
import json
import sys

from .edl import SNAP_RADIUS
from .pipeline import WORK, derived_file, load_cuts

OUTSIDE_KEEP = "reel: outside keep"


def merged(ranges, duration):
    """Sorted, clamped to [0, duration], overlaps and touches joined. A range's "pin" flag rides along (see complement)."""
    result = []
    for start, end, *flags in sorted([max(0.0, start), min(duration, end), *flags] for start, end, *flags in ranges):
        if end <= start:
            continue
        if result and start <= result[-1][1]:
            result[-1][1] = max(result[-1][1], end)
        else:
            result.append([start, end, *flags])
    return result


def complement(keep, duration):
    """The removals outside the keep ranges. A pinned keep pins the removal leading into it, so edl.py cannot snap
    that edge into a word the reel cuts (v5r QC r6: 180.05 snapped back into the 'ko' at 179.913)."""
    gaps, cursor = [], 0.0
    for start, end, *flags in keep:
        if start > cursor:
            gaps.append([cursor, start, OUTSIDE_KEEP, *flags])
        cursor = end
    if cursor < duration:
        gaps.append([cursor, duration, OUTSIDE_KEEP])
    return gaps


def inside(cutaway, keep):
    # edl.py may move a keep edge SNAP_RADIUS to a quiet point, so a cutaway authored on that edge still belongs.
    return any(start - SNAP_RADIUS <= cutaway["at"] and cutaway["end"] <= end + SNAP_RADIUS for start, end, *_ in keep)


def overlap(first, second):
    """Seconds shared by two merged range lists."""
    return sum(max(0.0, min(a_end, b_end) - max(a_start, b_start)) for a_start, a_end, *_ in first for b_start, b_end, *_ in second)


def reel_spec(video, spec, keep):
    """Removals = the full edit's removals + everything outside the (merged) keep ranges. Bleeps and blurs carry
    over unfiltered: pipeline.map_interval drops the ones that land on removed footage."""
    return {**spec, "base": spec.get("base", video), "reel": True, "remove": spec["remove"] + complement(keep, spec["duration"]),
            "cutaways": [cutaway for cutaway in spec.get("cutaways", []) if inside(cutaway, keep)]}


def main(video, keep_path):
    spec = load_cuts(video)
    keep = merged(json.loads((WORK / keep_path).read_text(encoding="utf-8"))["keep"], spec["duration"])
    reel = reel_spec(video, spec, keep)
    target = derived_file(WORK, f"cuts/{video}r.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(reel, indent=1), encoding="utf-8")
    kept = sum(end - start for start, end, *_ in keep)
    estimate = kept - overlap(keep, merged(spec["remove"], spec["duration"]))
    print(f"{target.name}: {len(keep)} keep ranges, {kept:.1f}s kept, about {estimate:.1f}s after the full edit's removals "
          f"(pause trim not counted), {len(reel['cutaways'])} cutaways")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
