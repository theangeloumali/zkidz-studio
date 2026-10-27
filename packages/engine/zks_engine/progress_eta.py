# Created by The Angelo Umali.
# Render ETAs and the status line's text. A stage's pace is its recent history (or a measured seed); a running stage
# blends in its own pace, trusted fully from a quarter in (its first seconds carry a browser start-up). A batch follows
# the runner: an edit's events, sfx and frames, then its master in the background while the next edit draws.
import statistics
import time

SEED_RATES = {"frames": 15.0, "master": 67.0}  # frames/s measured 2026-10-05: overlay 13-17, a 4K master ~67
FIXED_SECONDS = {"events": 3.0, "sfx": 8.0}
PRE_MASTER = ("events", "sfx", "frames")
TRUST_SHARE = 0.25  # the share done from which a running stage's own pace is trusted fully
SHOWN = 2  # running edits named on the line; the rest are counted


def pace_key(record):
    """The history a record's ETA is paced by: its stage, or its own pace key (transcribing per model)."""
    return record.get("pace", record["stage"])


def rate(stage, history):
    paces = [entry["units"] / entry["seconds"] for entry in reversed(history) if entry["stage"] == stage and entry["units"] > 0 and entry["seconds"] > 0]
    return statistics.median(paces[:10]) if paces else SEED_RATES.get(stage)


def stage_seconds(stage, frames, history):
    """A stage's expected length: fixed, by its frame pace, or (a join, a transcribe) the median of its past runs."""
    if stage in FIXED_SECONDS:
        return FIXED_SECONDS[stage]
    pace = rate(stage, history)
    if pace and frames:
        return frames / pace
    past = [entry["seconds"] for entry in reversed(history) if entry["stage"] == stage and not entry["units"]][:10]
    return statistics.median(past) if past else 0.0


def stage_left(record, history, now):
    """Seconds left in a started stage."""
    total, done, elapsed = record.get("total") or 0, record.get("done") or 0, now - record["started"]
    if not total:
        return max(0.0, stage_seconds(pace_key(record), record.get("frames"), history) - elapsed)
    pace = rate(pace_key(record), history)
    planned = (total - done) / pace if pace else None
    if not done:
        return max(0.0, planned - elapsed) if planned else 0.0
    live = (total - done) * elapsed / done
    if planned is None:
        return live
    trust = min(1.0, done / total / TRUST_SHARE)
    return trust * live + (1 - trust) * planned


def eta_seconds(record, history, now):
    """Whole seconds left in a running stage, the record's etaS; None until a pace, seed or past run says anything."""
    if record.get("state") != "running":
        return None
    stage, total = pace_key(record), record.get("total")
    known = (record.get("done") or rate(stage, history)) if total else stage_seconds(stage, record.get("frames"), history)
    if not known:
        return None
    left = round(stage_left(record, history, now))
    # Waiting on a first unit past the seed's estimate: 0 would claim it is about to finish, so say nothing.
    return None if left == 0 and total and not record.get("done") else left


def ahead(edit, history, now):
    """(seconds before its master, seconds of its master) still ahead of an edit."""
    frames, stage = edit.get("frames") or 0, edit["stage"]
    if edit["state"] == "queued":
        return sum(stage_seconds(name, frames, history) for name in PRE_MASTER), stage_seconds("master", frames, history)
    left = stage_left(edit, history, now) if edit["state"] == "running" else stage_seconds(stage, edit.get("total") or frames, history)
    if stage == "master":
        return 0.0, left
    if stage not in PRE_MASTER:
        return left, 0.0  # a join or a transcribe: its own end is all that is known
    later = PRE_MASTER[PRE_MASTER.index(stage) + 1:]
    return left + sum(stage_seconds(name, frames, history) for name in later), stage_seconds("master", frames, history)


def simulate(edits, history, now):
    """Each edit's finish and the batch's, the runner's way: a master waits for the one before it and runs while the next
    edit draws."""
    finish, master_end, cursor = {}, now, now
    for edit in edits:
        before, master = ahead(edit, history, now)
        start = max(cursor + before, master_end)
        master_end = start + master if master else master_end
        finish[edit["video"]] = start + master
        cursor = start
    return finish, max(finish.values(), default=now)


def clock(epoch):
    return time.strftime("%H:%M", time.localtime(epoch))


def percent(edit):
    """A counted stage's share done, or None for one without units (a join, a transcribe)."""
    return round(100 * edit["done"] / edit["total"]) if edit.get("total") else None


def describe(edit, finish):
    if edit["state"] == "waiting":
        return f"{edit['video']} {edit['stage']} waiting"
    share = f" {percent(edit)}%" if edit.get("total") else ""
    return f"{edit['video']} {edit['stage']}{share} ⏱ {clock(finish[edit['video']])}"


def line(active, finished, planned, history, now, edited=()):
    """The status line's text: named running edits, failures, edits being written, the queue, the batch ETA and the
    planned count."""
    finish, batch = simulate(active, history, now)
    started = [edit for edit in active if edit["state"] in ("running", "waiting")]
    parts = [describe(edit, finish) for edit in started[:SHOWN]]
    parts += [f"❌ {edit['video']} {edit['stage']} failed" for edit in finished if edit["state"] == "failed"]
    parts += [f"⚠ {edit['video']} stopped" for edit in finished if edit["state"] == "stopped"]
    parts += [f"✏️ {edit['video']} editing since {clock(edit['started'])}" for edit in edited]
    rest = [edit for edit in active if edit not in started[:SHOWN]]
    if rest:
        parts.append(f"+{len(rest)} {'queued' if all(edit['state'] == 'queued' for edit in rest) else 'more'}")
    if len(active) > 1:
        parts.append(f"all ⏱ {clock(batch)}")
    if planned:
        parts.append(f"✅ {sum(edit['state'] == 'done' for edit in planned)}/{len(planned)}")
    return f"🎬 {' · '.join(parts)}" if parts else ""


def timeline(finished, planned, edited, now, until):
    """With nothing rendering, no heartbeat rewrites the line, so it is written ahead: one (expires, text) per moment a
    part leaves (`until`), listing the parts still due. The status line shows the first line not yet expired."""
    def due(records, end):
        return [record for record in records if until(record) >= end]

    plan_until = max(map(until, planned), default=0)  # a batch's count stays until its last edit leaves
    ends = sorted(end for end in {plan_until, *map(until, finished), *map(until, edited)} if end > now)
    return [(end, line([], due(finished, end), planned if plan_until >= end else [], [], now, due(edited, end))) for end in ends] or [(now, "")]
