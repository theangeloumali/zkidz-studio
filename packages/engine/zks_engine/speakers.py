# Created by The Angelo Umali.
# Who speaks when (#45) and whose face is blurred (#44). YuNet faces in the proxy are linked into tracks by position, a
# track's mouth motion against its own upper face scores each transcript utterance, and SFace embeddings tell the creator
# from everyone else. Cached per proxy in work/faces/<base>.speakers.json, scanned in chunks only where the edit keeps footage.
# Usage (work dir): python -m zks_engine.speakers v1
import bisect
import json
import sys
import time

import numpy as np

from . import faces, pipeline, progress
from .home import data_dir
from .specs import SpecError
from .transcribe.whispercpp import load_lock

SCAN_FPS, DETECT_EVERY = 6, 2  # frames read per second; a detection on every other one (3 a second)
CENSUS_FPS = 0.5  # the whole-source pass that finds the creator: who is on screen most
CHUNK_S = 30  # the scan's cache unit: a cut spec change rescans only the chunks it newly keeps
LINK_GAP_S, LINK_REACH = 2.0, 1.0  # a face joins a track seen within 2 s, its centre within one face width
EMBED_MIN_WIDTH, EMBED_MIN_SCORE = 36, 0.85  # smaller or less certain faces give embeddings that match no one
SAME_PERSON = 0.4  # SFace cosine: 0.53-0.94 for him across the session, at most 0.28 against a colleague
GROUP_LIKENESS, MIN_SOLO = 0.5, 10  # the census's grouping bar; solo frames needed before "alone most" decides
UTTERANCE_GAP_S, MIN_TURN_S = 0.6, 2.0  # words this close are one utterance; a shorter one keeps the speaker
WINDOW_S = 3.0  # a long utterance is scored in pieces this long, so the camera can switch inside it
MOTION_FLOOR = 0.25  # aligned lip change per contrast: listeners measured 0.14-0.18, speakers 0.3-0.6
SWITCH_RATIO = 1.3  # a new speaker takes the camera only when their lips move this much more than the current one's
SAVE_EVERY_S = 60  # the scan cache is written at most this often mid-scan
FOLLOW_SCALE = 1.4  # the follow window's zoom into the band: a seated face ~15 % of the frame width
SFACE = "sface"


def recognizer():
    import cv2

    pin = load_lock()["models"][SFACE]
    path = data_dir("models") / pin["file"]
    if not path.is_file():
        raise SpecError(f"the face blur needs SFace ({pin['file']}) in {data_dir('models')}; run pnpm zks setup")
    return cv2.FaceRecognizerSF_create(str(path), "")


def centre(box):
    return box[0] + box[2] / 2, box[1] + box[3] / 2


# --- the scan: faces, mouth motion and embeddings at DETECT rate --------------------------------------------------------

def mouth_motion(gray, previous, row):
    """How much the lips moved between two frames: the mouth patch aligned onto itself first (phase correlation), so a
    head that turns or nods leaves almost nothing, then the leftover change against the patch's own contrast."""
    import cv2

    width = max(abs(row[12] - row[10]) * 1.8, row[2] * 0.6)
    height = width * 0.8
    left, top = int((row[10] + row[12]) / 2 - width / 2), int((row[11] + row[13]) / 2 - height / 2)
    before, after = (frame[max(0, top):top + int(height), max(0, left):left + int(width)] for frame in (previous, gray))
    if before.shape != after.shape or min(before.shape, default=0) < 8:
        return 0.0
    (dx, dy), _ = cv2.phaseCorrelate(before, after)
    aligned = cv2.warpAffine(before, np.float32([[1, 0, dx], [0, 1, dy]]), before.shape[::-1], borderMode=cv2.BORDER_REPLICATE)
    return float(np.abs(after - aligned)[2:-2, 2:-2].mean() / (after.std() + 1))


def scan(proxy, start, duration):
    """[{t, faces: [{box, score, motion, embedding}]}] over start..start+duration (source seconds)."""
    import cv2

    detector, sface = faces.detector(pipeline.OUTPUT), recognizer()
    found, previous, rows = [], None, []
    for index, image in enumerate(faces.frames(proxy, SCAN_FPS, start, duration, size=pipeline.OUTPUT)):
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(np.float32)
        if index % DETECT_EVERY == 0:
            _, detected = detector.detect(np.ascontiguousarray(image))
            rows = [] if detected is None else list(detected)
            sample = {"t": round(start + index / SCAN_FPS, 3), "faces": []}
            for row in rows:
                embedding = None
                if row[2] >= EMBED_MIN_WIDTH and row[-1] >= EMBED_MIN_SCORE:
                    feature = sface.feature(sface.alignCrop(image, row))[0]
                    embedding = [round(float(v), 5) for v in feature / np.linalg.norm(feature)]
                sample["faces"].append({"box": [round(float(v)) for v in row[:4]], "score": round(float(row[-1]), 3), "motion": 0.0, "embedding": embedding})
            found.append(sample)
        elif previous is not None and rows:
            for row, entry in zip(rows, found[-1]["faces"]):
                entry["motion"] = round(entry["motion"] + mouth_motion(gray, previous, row) / (DETECT_EVERY - 1), 3)
        previous = gray
    return found


# --- tracks, identities, turns ----------------------------------------------------------------------------------------

def link(samples):
    """Gives every face a `track`: the nearest track seen within LINK_GAP_S whose last centre is within LINK_REACH widths."""
    tracks = []  # [last t, last box]
    for sample in samples:
        taken = set()
        for entry in sorted(sample["faces"], key=lambda item: -item["box"][2]):
            cx, cy = centre(entry["box"])
            best, best_distance = None, None
            for track, (last_t, box) in enumerate(tracks):
                if track in taken or sample["t"] - last_t > LINK_GAP_S:
                    continue
                distance = np.hypot(cx - centre(box)[0], cy - centre(box)[1])
                if distance <= LINK_REACH * max(box[2], entry["box"][2]) and (best is None or distance < best_distance):
                    best, best_distance = track, distance
            if best is None:
                best = len(tracks)
                tracks.append(None)
            tracks[best] = (sample["t"], entry["box"])
            entry["track"] = best
            taken.add(best)
    return samples


def track_rows(samples):
    """{track: every embedding its faces carry}."""
    rows = {}
    for sample in samples:
        for entry in sample["faces"]:
            if entry.get("embedding") is not None:
                rows.setdefault(entry["track"], []).append(entry["embedding"])
    return {track: np.asarray(vectors, float) for track, vectors in rows.items()}


def track_embeddings(samples):
    return {track: (lambda mean: mean / np.linalg.norm(mean))(rows.mean(axis=0)) for track, rows in track_rows(samples).items()}


def groups(embeddings):
    """People among `embeddings`: repeatedly the face with the most look-alikes and everyone like it (GROUP_LIKENESS), so
    small faces' cross-person likeness (up to ~0.45) cannot chain two people into one. -> [(centroid, count)], largest first."""
    vectors = np.asarray(embeddings, float)
    if not len(vectors):
        return []
    alike = vectors @ vectors.T >= GROUP_LIKENESS
    left, found = np.ones(len(vectors), bool), []
    while left.any():
        medoid = int(np.argmax(np.where(left, (alike & left).sum(1), -1)))
        members = alike[medoid] & left
        left &= ~members
        total = vectors[members].sum(0)
        found.append((total / np.linalg.norm(total), int(members.sum())))
    return sorted(found, key=lambda group: -group[1])


def creator_identity(frames):
    """The creator's face from the census ([{faces, embeddings}]): the person most often alone on screen, since a creator
    talks to the camera on their own while guests and colleagues come in groups; else the person seen most."""
    solo = [frame["embeddings"][0] for frame in frames if frame["faces"] == 1 and frame["embeddings"]]
    pool = solo if len(solo) >= MIN_SOLO else [vector for frame in frames for vector in frame["embeddings"]]
    found = groups(pool)
    return found[0][0] if found else None


def creator_tracks(samples, reference):
    """The creator's tracks: every track whose face matches `reference`, and every track no face could be matched on (him
    turned to a screen) that picks up within LINK_GAP_S of one of his, unless it was on screen beside one. Any other
    unmatched track is someone else's, so the blur errs toward covering it."""
    embedded, rows = track_embeddings(samples), track_rows(samples)
    creator = set() if reference is None else {track for track, vector in embedded.items() if float(vector @ reference) >= SAME_PERSON}
    beside = lambda: {entry["track"] for sample in samples if any(e["track"] in creator for e in sample["faces"]) for entry in sample["faces"]}  # noqa: E731
    # One reference is one view of him: a track of him turned away matches it at ~0.27, but most of its faces match a
    # face in a track already his (0.76 on the OnePuhunan reel; colleagues at most 0.34), so his tracks grow from his own.
    while mine := [rows[track] for track in creator if track in rows]:
        known, near = np.vstack(mine).T, beside()
        grown = {track for track in set(rows) - creator - near if np.median((rows[track] @ known).max(axis=1)) >= SAME_PERSON}
        if not grown:
            break
        creator |= grown
    spans = {}
    for sample in samples:
        for entry in sample["faces"]:
            first, _ = spans.get(entry["track"], (sample["t"], None))
            spans[entry["track"]] = (first, sample["t"])
    unmatched = set(spans) - set(embedded) - beside()
    while grown := {track for track in unmatched - creator
                    if any(spans[mine][0] <= spans[track][0] <= spans[mine][1] + LINK_GAP_S for mine in creator)}:
        creator |= grown
    return creator


def identities(samples, reference, creator):
    """{creator, others}: the faces the blur gate tells apart. The creator's side holds every one of his tracks, not
    only the reference, so a turned face of his reads as his."""
    embedded = track_embeddings(samples)
    return {"creator": ([] if reference is None else [reference.tolist()]) + [embedded[track].tolist() for track in sorted(creator) if track in embedded],
            "others": [vector.tolist() for track, vector in embedded.items() if track not in creator]}


def utterances(words):
    """Voiced spans from the words, each cut into WINDOW_S pieces: fast back-and-forth reads as one long utterance."""
    spans = []
    for word in words:
        if spans and word["at"] - spans[-1][1] < UTTERANCE_GAP_S:
            spans[-1][1] = max(spans[-1][1], word["end"])
        else:
            spans.append([word["at"], word["end"]])
    pieces = []
    for at, end in spans:
        count = max(1, round((end - at) / WINDOW_S))
        pieces += [[at + (end - at) * k / count, at + (end - at) * (k + 1) / count] for k in range(count)]
    return pieces


def turns(words, samples, creator):
    """[{at, end, track, box}]: each utterance goes to the track whose mouth moved most (over MOTION_FLOOR, on screen for
    half of it). Otherwise, or for an utterance under MIN_TURN_S, the speaker before it if still on screen, then the creator,
    then the largest face: his voice from off screen, or his head moving more than his lips."""
    times = [sample["t"] for sample in samples]
    spans = utterances(words)
    result = []
    for index, (at, end) in enumerate(spans):
        inside = samples[bisect.bisect_left(times, at):bisect.bisect_right(times, end)]
        motion, sizes = {}, {}
        for sample in inside:
            for entry in sample["faces"]:
                motion.setdefault(entry["track"], []).append(entry["motion"])
                sizes[entry["track"]] = max(sizes.get(entry["track"], 0), entry["box"][2])
        present = {track for track, values in motion.items() if len(values) * 2 >= len(inside)}
        scores = {track: float(np.mean(motion[track])) for track in present}
        best = max(scores, key=scores.get) if scores else None
        held = result[-1]["track"] if result else None
        if held in scores and best != held and scores[best] < scores[held] * SWITCH_RATIO:
            best = held  # hysteresis: a listener's fidget is not a new speaker
        if best is None or scores[best] < MOTION_FLOOR or end - at < MIN_TURN_S:
            fallbacks = [held, *sorted(present & creator), *sorted(present, key=sizes.get, reverse=True)]
            best = next((track for track in fallbacks if track in present), None)
        if best is None:
            continue
        boxes = [entry["box"] for sample in inside for entry in sample["faces"] if entry["track"] == best]
        stop = spans[index + 1][0] if index + 1 < len(spans) else end
        if result and result[-1]["track"] == best:
            result[-1]["end"] = stop
        else:
            result.append({"at": at, "end": stop, "track": best, "box": [round(float(v)) for v in np.median(boxes, axis=0)]})
    return result


# --- follow and blur ----------------------------------------------------------------------------------------------------

def follow_reframes(turn_list, band_at, manual=()):
    """Engine reframe rows [at, end, cx, cy, scale] on each speaker's face, cut around the manual windows, which win."""
    rows = []
    for turn in turn_list:
        bx, by, bw, bh = band_at(turn["at"])
        cx, cy = centre(turn["box"])
        # The face a third down the window, not centred: cy is the window's centre as a share of the band.
        share_y = (cy - by) / bh + (1 / 2 - 1 / 3) / FOLLOW_SCALE
        pieces = [[turn["at"], turn["end"]]]
        for at, end, *_ in manual:
            pieces = [piece for left, right in pieces for piece in ([left, min(right, at)], [max(left, end), right]) if piece[1] > piece[0]]
        rows += [[left, right, round((cx - bx) / bw, 4), round(min(max(share_y, 0.0), 1.0), 4), FOLLOW_SCALE] for left, right in pieces]
    return rows


# --- the analysis the edit stage reads ----------------------------------------------------------------------------------

def kept_chunks(kept):
    return sorted({chunk for at, end in kept for chunk in range(int(at // CHUNK_S), int(end // CHUNK_S) + 1)})


def census(proxy):
    """[{faces, embeddings}] per frame over the whole source at CENSUS_FPS: how many faces, and each clear one's embedding."""
    detector, sface = faces.detector(pipeline.OUTPUT), recognizer()
    found = []
    for image in faces.frames(proxy, CENSUS_FPS, size=pipeline.OUTPUT):
        _, rows = detector.detect(np.ascontiguousarray(image))
        rows = [] if rows is None else rows
        clear = [row for row in rows if row[2] >= EMBED_MIN_WIDTH and row[-1] >= EMBED_MIN_SCORE]
        vectors = [sface.feature(sface.alignCrop(image, row))[0] for row in clear]
        found.append({"faces": len(rows), "embeddings": [[round(float(v), 5) for v in vector / np.linalg.norm(vector)] for vector in vectors]})
    return found


def analyse(base, kept, words):
    """{samples, turns, creator, identities} over the chunks `kept` ([at, end] source seconds) touches. The census and the
    chunks are cached per proxy, so a changed cut spec scans only the chunks it newly keeps."""
    proxy = pipeline.WORK / "mezz" / f"{base}.mp4"
    if not proxy.is_file():
        raise SpecError(f"{base} has no proxy at work/mezz/{base}.mp4; ingest it first")
    cache_path = pipeline.WORK / "faces" / f"{base}.speakers.json"
    stamp = f"{proxy.stat().st_size}:{proxy.stat().st_mtime_ns}"
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.is_file() else {}
    cache = cache if cache.get("proxy") == stamp else {"proxy": stamp}
    chunks = cache.setdefault("chunks", {})
    wanted = [chunk for chunk in kept_chunks(kept) if str(chunk) not in chunks]
    passes = [("census", lambda: census(proxy))] if "census" not in cache else []
    passes += [(chunk, lambda chunk=chunk: scan(proxy, chunk * CHUNK_S, CHUNK_S)) for chunk in wanted]
    cache_path.parent.mkdir(exist_ok=True)
    with progress.job(base, "faces", total=len(passes), unit="passes") as stage:
        saved, unsaved = time.monotonic(), False
        try:
            for done, (name, run) in enumerate(passes, 1):
                (cache if name == "census" else chunks)[str(name)] = run()
                unsaved = True
                # Not rewritten per pass (the file reaches ~20 MB on a 43-min source); finished passes survive a stop below.
                if time.monotonic() - saved >= SAVE_EVERY_S:
                    cache_path.write_text(json.dumps(cache), encoding="utf-8")
                    saved, unsaved = time.monotonic(), False
                stage.update(done)
        finally:
            if unsaved:
                cache_path.write_text(json.dumps(cache), encoding="utf-8")
    keep = set(kept_chunks(kept))
    samples = link([sample for chunk in sorted(chunks, key=int) if int(chunk) in keep for sample in chunks[chunk]])
    reference = creator_identity(cache["census"])
    creator = creator_tracks(samples, reference)
    return {"samples": samples, "turns": turns(words, samples, creator), "creator": sorted(creator), "identities": identities(samples, reference, creator)}


def main(argv):
    video = argv[0]
    spec = pipeline.load_cuts(video)
    base = spec.get("base", video)
    words = json.loads((pipeline.WORK / "transcripts" / f"{base}.words.json").read_text(encoding="utf-8"))
    report = analyse(base, [[0, spec["duration"]]], words)
    print(json.dumps({"turns": report["turns"], "creator": report["creator"], "others": len(report["identities"]["others"])}, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
