# Created by The Angelo Umali.
"""Encodes the card clips footage cues (footageCard, gradeWipe) play inside the HyperFrames overlay.

Usage (from the work dir): python -m zks_engine.cardclip <target>    e.g. v23, or v23r:v23+v23r
`node hf/build.js <target> --clips` writes edl/<video>.clips.json (per cue: the source frame runs its edited window shows,
and its grade); each clip is cut from mezz/<base>.mp4 (sources/<base>.mkv for a `crop`) by decode index, graded like the
master, with the cut spec's blur baked in, and encoded with the active backend into cardclips/. A clip is named by what it
shows, so one already there is kept while its blur is unchanged.
"""
import json
import os
import subprocess
import sys

from . import backends, face_mask, faces, ffio, matte, render_final, speakers
from .backends.graph import BT709_TV, restamp
from .blur import blur_graph, blur_regions, ranges_expr
from .edl import FACECAM_ZOOM, PUNCH_TOP
from .pipeline import FPS, HF_DIR, OUTPUT, WORK, chain, load_cuts, load_edl, probe_video, rotation_of, upright_dims
from .slots import slot

# A keyframe every 30 frames keeps HyperFrames' seeks short (NVENC refuses -g 1); no B-frames keeps decode order plain.
CARD_ENCODE = ["-g", "30", "-bf", "0", *render_final.BT709_TAGS]


def manifest(target, style=()):
    """edl/<video>.clips.json, freshly written by build.js from the cue sheet. `style` is the render's --style flags: without
    them build.js draws the house theme and refuses a learning sheet's kinds."""
    result = subprocess.run(["node", str(HF_DIR / "build.js"), target, "--clips", *style], cwd=WORK, capture_output=True, text=True,
                            encoding="utf-8", errors="replace", env={**os.environ, "SHORTFORM_WORK": str(WORK)})
    if result.returncode:
        raise RuntimeError(f"build.js {target} --clips failed:\n{result.stderr.strip()}")
    return json.loads((WORK / "edl" / f"{target.split(':')[0]}.clips.json").read_text(encoding="utf-8"))


def look(edl, grade):
    """The master's own grade for an "edit" clip (so a grow hands off without a jump); none for "raw"."""
    if grade not in ("edit", "raw"):
        raise ValueError(f"a card clip's grade is edit or raw, not {grade!r}")
    return None if grade == "raw" else render_final.grade_of(edl)


def punched_frames(clip):
    """Clip frame ranges of the punched runs: the master crops those the same way."""
    spans, offset = [], 0
    for start, end, punched in clip["ranges"]:
        if punched:
            spans.append((offset, offset + end - start))
        offset += end - start
    return spans


def clip_regions(clip, edl, spec, frame_size=OUTPUT):
    """The cut spec's blur on clip frames: the clip's source runs as an edit of their own, mapped like the master's."""
    segments, target = [], 0
    for start, end, _ in clip["ranges"]:
        segments.append({"in": start, "out": end, "target": target})
        target += end - start
    return blur_regions(spec, {**edl, "frames": target, "segments": segments}, frame_size)


def even(value):
    return round(value / 2) * 2


def card_rects(clip, frame_size):
    """The source rect each branch crops, (unpunched, punched): the card's `crop` (1080 grid) scaled to the source, or the
    whole frame; on punched frames that rect sits inside the master's punch window, scaled back to full."""
    width, height = frame_size
    scale = width / OUTPUT[0]
    x, y, w, h = (even(value * scale) for value in clip["crop"]) if clip.get("crop") else (0, 0, width, height)
    window_w, window_h = even(width / FACECAM_ZOOM), even(height / FACECAM_ZOOM)
    left, top = (width - window_w) / 2, round(height * PUNCH_TOP)
    punched = (left + x * window_w / width, top + y * window_h / height, w * window_w / width, h * window_h / height)
    # Offsets round down like ffmpeg's crop on 4:2:0 (the master's odd punch top 55 crops at 54); sizes round to even.
    return (x, y, w, h), (int(punched[0]) // 2 * 2, int(punched[1]) // 2 * 2, even(punched[2]), even(punched[3]))


def crop_regions(regions, rect, out_size):
    """Blur boxes (source pixels) clipped to a branch's rect and mapped into its output; a box that misses it drops out."""
    rx, ry, rw, rh = rect
    sx, sy = out_size[0] / rw, out_size[1] / rh
    mapped = []
    for x, y, w, h, ranges in regions:
        left, top, right, bottom = max(x, rx), max(y, ry), min(x + w, rx + rw), min(y + h, ry + rh)
        if right > left and bottom > top:
            box = (even((left - rx) * sx), even((top - ry) * sy), even((right - rx) * sx), even((bottom - ry) * sy))
            mapped.append((box[0], box[1], box[2] - box[0], box[3] - box[1], ranges))
    return mapped


def framed_crop(band, face):
    """A 9:16 window inside a letterboxed picture band (1080 grid) centred on `face`, else on the picture: an uncropped card
    on a square or landscape source would show the black bars and the whole room."""
    bx, by, bw, bh = band
    w, h = even(bh * OUTPUT[0] / OUTPUT[1]), even(bh)
    centre = face[0] + face[2] / 2 if face else bx + bw / 2
    x = int(min(max(centre - w / 2, bx), bx + bw - w)) // 2 * 2
    return [x, int(by) // 2 * 2, w, h]


def write_card_mask(clip, samples, creator, out):
    """The bystander mask for exactly the source frames a card shows, in its own order (#44): cards play moments the edit's
    own mask never drew."""
    frames = [frame for start, end, _ in clip["ranges"] for frame in range(start, end)]
    key, key_file = face_mask.mask_key(samples, creator, clip["ranges"]), out.with_suffix(".key")
    if out.is_file() and key_file.is_file() and key_file.read_text(encoding="utf-8") == key:
        return
    key_file.unlink(missing_ok=True)
    index = face_mask.track_index(samples)
    matte.encode((face_mask.draw(samples, frame / FPS, creator, index=index) for frame in frames), len(frames), out)
    key_file.write_text(key, encoding="utf-8")


def clip_record(clip, edl, spec, mask):
    """What a clip was encoded with: its name hashes what it shows, so a blur box, crop or bystander mask change re-encodes."""
    faces = mask.with_suffix(".key").read_text(encoding="utf-8") if mask else None
    return json.dumps({"boxes": clip_regions(clip, edl, spec), "crop": clip.get("crop"), "faces": faces})


def creator_box(found, at):
    """The creator's face nearest source second `at`, else None."""
    creator, near = set(found["creator"]), None
    for sample in found["samples"]:
        for entry in sample["faces"]:
            if entry["track"] in creator and (near is None or abs(sample["t"] - at) < abs(near[0] - at)):
                near = (sample["t"], entry["box"])
    return near[1] if near else None


def prepare(clip, base, found):
    """(the clip with a framed crop on letterboxed footage, its bystander mask or None). `found` is the face analysis of
    the cards' moments when the cut spec blurs other faces, else None."""
    at = clip["ranges"][0][0] / FPS
    band = faces.recorded_band(WORK, base, at)
    if not clip.get("crop") and band and band[3] < OUTPUT[1]:
        clip = {**clip, "crop": framed_crop(band, creator_box(found, at) if found else None)}
    if found is None:
        return clip, None
    mask = (WORK / clip["file"]).with_suffix(".faces.mkv")
    write_card_mask(clip, found["samples"], set(found["creator"]), mask)
    return clip, mask


def command(clip, edl, source, out, spec, backend, frame_size=OUTPUT, times=None, faces=None):
    """Each branch (unpunched, and punched when the clip has a punched run) crops its source rect straight to the card's
    size and blurs there, so no frame is ever scaled whole; the punched one overlays on its runs, then the grade. With the
    source's frame `times` the input seeks between the first run's first frame and the one before, so select counts from there."""
    first = clip["ranges"][0][0] if times else 0
    seek = ["-ss", f"{(times[first - 1] + times[first]) / 2:.6f}"] if times and first else []
    keep = [(start - first, end - first) for start, end, _ in clip["ranges"]]
    decode = chain(f"select='{ranges_expr(keep)}'", restamp(edl), "format=yuv420p")
    punched = punched_frames(clip)
    rects = card_rects(clip, frame_size)
    out_w, out_h = OUTPUT[0], even(OUTPUT[0] * rects[0][3] / rects[0][2])
    regions = clip_regions(clip, edl, spec, frame_size)
    names = ("wide", "tight") if punched else ("wide",)
    # The bystander frost goes on the whole decoded frame first, so every crop and the punch carry it.
    footage = render_final.faces_graph(f"[0:v]{decode}", f"[1:v]{restamp(edl)},scale={frame_size[0]}:{frame_size[1]}", frame_size) if faces else f"[0:v]{decode}"
    graph = footage + (f",split=2{''.join(f'[{name}_src]' for name in names)};" if punched else "[wide_src];")
    cards = []
    for name, (x, y, w, h) in zip(names, rects):
        graph += f"[{name}_src]crop={w}:{h}:{x}:{y},scale={out_w}:{out_h}:flags=lanczos[{name}_card];"
        blurs, base = blur_graph(crop_regions(regions, (x, y, w, h), (out_w, out_h)), f"{name}_card", (out_w, out_h), f"{name}_")
        graph += blurs
        cards.append(f"[{base}]")
    graph += f"{cards[0]}{cards[1]}overlay=enable='{ranges_expr(punched)}'," if punched else cards[0]
    graph += chain(look(edl, clip["grade"]), "format=yuv420p", BT709_TV) + f"{backend.upload}[clip]"
    return [ffio.ffmpeg_bin(), "-v", "error", "-y", *backend.device, *backend.decode, *seek, *ffio.user_input_args(source),
            *(["-i", str(faces)] if faces else []), "-filter_complex", graph, "-map", "[clip]", "-an", *backend.proxy, *CARD_ENCODE,
            "-fps_mode", "passthrough", "-video_track_timescale", str(edl["fps_num"]), "-frames:v", str(clip["frames"]), str(out)]


def assert_frames(path, got, expected):
    if got != expected:
        raise RuntimeError(f"{path.name}: {got} frames, expected {expected}")


def blur_record(clip_path):
    """The blur a clip was encoded with: its name hashes what it shows but not the cut spec, so a blur edit re-encodes."""
    return clip_path.with_suffix(".blur.json")


def prune(folder, target, wanted):
    """Removes the clips this target (cue list) last wanted and no longer does, unless another target still wants them."""
    records = folder / ".targets"
    records.mkdir(exist_ok=True)
    mine = records / f"{target.replace(':', '--')}.json"

    def names(record):
        return set(json.loads(record.read_text(encoding="utf-8")))

    others = set().union(*(names(record) for record in records.glob("*.json") if record != mine))
    wanted_names = {path.name for path in wanted}
    for name in (names(mine) if mine.exists() else set()) - wanted_names - others:
        mask = (folder / name).with_suffix(".faces.mkv")
        for path in (folder / name, blur_record(folder / name), mask, mask.with_suffix(".key")):
            path.unlink(missing_ok=True)
    mine.write_text(json.dumps(sorted(wanted_names)), encoding="utf-8")


def source_of(clip, base, mezz):
    """What a card cuts from and its upright size: the 4K base source for a cropped card (detail in a small part of the
    frame), else the 1080 mezz."""
    if not clip.get("crop"):
        return mezz, OUTPUT
    source = WORK / "sources" / f"{base}.mkv"
    if not source.exists():
        raise FileNotFoundError(f"{clip['id']}: a cropped card cuts from {source}, which is missing")
    stream = probe_video(source)
    width, height = upright_dims(stream)
    if width * OUTPUT[1] != height * OUTPUT[0] or rotation_of(stream) % 360:
        raise ValueError(f"{source.name} is {width}x{height} or turned; a cropped card needs an upright 9:16 source")
    return source, (width, height)


def encode_clips(target, data):
    """Every clip of a manifest, each skipped while its file, frame count and blur are unchanged."""
    folder = WORK / "cardclips"
    if not data["clips"]:
        if folder.exists():
            prune(folder, target, set())
        return print(f"{target}: no footage cue, no card clips")
    edl, spec = load_edl(data["video"]), load_cuts(data["video"])
    mezz = WORK / "mezz" / f"{data['base']}.mp4"
    if not mezz.exists():
        raise FileNotFoundError(f"no proxy at {mezz}: card clips are cut from the 1080 mezz")
    folder.mkdir(exist_ok=True)
    prune(folder, target, {WORK / clip["file"] for clip in data["clips"]})
    backend = backends.active()
    shown = [[start / FPS, end / FPS] for clip in data["clips"] for start, end, _ in clip["ranges"]]
    found = speakers.analyse(data["base"], shown, []) if spec.get("blur_faces") == "others" else None
    with slot("gpu", f"cardclip {target} ({WORK})"):
        for clip in data["clips"]:
            clip, mask = prepare(clip, data["base"], found)
            out, record = WORK / clip["file"], blur_record(WORK / clip["file"])
            blurred = clip_record(clip, edl, spec, mask)
            if out.exists() and record.exists() and record.read_text(encoding="utf-8") == blurred and render_final.count_frames(out) == clip["frames"]:
                print(f"{clip['id']}: unchanged, kept")
                continue
            partial = out.with_suffix(".partial.mp4")
            source, size = source_of(clip, data["base"], mezz)
            times = render_final.frame_times(source)  # cached per file: the packet table of a 4K source is long
            subprocess.run(command(clip, edl, source, partial, spec, backend, size, times, mask), check=True)
            assert_frames(partial, render_final.count_frames(partial), clip["frames"])
            partial.replace(out)
            record.write_text(blurred, encoding="utf-8")
            print(f"{clip['id']}: {clip['frames']} frames ({clip['grade']}) -> {out}")


def encode(target, style=()):
    encode_clips(target, manifest(target, style))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    try:
        encode(sys.argv[1], sys.argv[2:])
    except (RuntimeError, FileNotFoundError, ValueError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
