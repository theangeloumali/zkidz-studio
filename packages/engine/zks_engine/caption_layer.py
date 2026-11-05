# Created by The Angelo Umali.
# Expands the caption plates the HyperFrames pass wrote (frames/<v>.cc.json + <v>.plates/) into one RGBA PNG per edited
# frame, frames/<v>.cc/, which render_final lays over the cards before their one upload.
#   Blank and settled frames are hard links; only the frames where a caption is moving are drawn, in parallel.
import hashlib
import io
import json
import os
import shutil
import sys
import threading
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

from .pipeline import OUTPUT, WORK

LINKS_PER_FILE = 1000  # NTFS refuses a 1024th hard link to one file
PNG_LEVEL = 6  # measured: as fast as level 1 on these mostly transparent frames, and 8x smaller
DRAW_WORKERS = min(os.cpu_count() or 1, 16)
DRAWING = hashlib.sha256(Path(__file__).read_bytes()).digest()  # in the cache key: a drawing change redraws


def rename_retrying(source, target, attempts=6, wait=0.5):
    """Path.rename that waits out a folder Defender or the indexer holds for a moment (WinError 5 on v105c)."""
    for attempt in range(attempts):
        try:
            return source.rename(target)
        except PermissionError:
            if attempt == attempts - 1:
                raise
            time.sleep(wait)


def frame_name(index):
    return f"{index:05d}.png"


def folder_key(folder):
    """The key render.js keeps in a folder it drew (`.hash`), or None while it is redrawing or never drew it."""
    key = folder / ".hash"
    return key.read_text(encoding="utf-8") if key.exists() else None


def complete(folder, frames):
    try:
        names = set(os.listdir(folder))
    except OSError:
        return False
    return names == {frame_name(index) for index in range(frames)}


def frame_layers(sheet, plates):
    """Per frame, the captions visible on it as (plate, alpha, dy), in list order. A caption's `hold` keeps it drawn that many
    frames past its end, under the words state fading in over it."""
    layers = [[] for _ in range(sheet["frames"])]
    for caption, plate in zip(sheet["captions"], plates):
        moving = {frame: (alpha, dy) for frame, alpha, dy in caption["motion"]}
        for frame in range(caption["first"], min(caption["end"] + caption.get("hold", 0), sheet["frames"])):
            alpha, dy = moving.get(frame, (1.0, 0.0))
            if alpha > 0:
                layers[frame].append((plate, alpha, dy))
    return layers


def faded(plate, alpha):
    """The plate with its opacity scaled by `alpha`."""
    if alpha >= 1:
        return plate
    red, green, blue, opacity = plate.split()
    return Image.merge("RGBA", (red, green, blue, opacity.point(lambda value: round(value * alpha))))


def draw(task):
    """Frames of [(path, [(plate, alpha, dy), ...], cards)]: each plate faded, moved dy whole pixels down (render.js floors
    it, as Chrome places the text) and laid "over" the ones before it. `cards`, when set, is the front frame drawn after
    the captions in one page: render_final lays this layer over the cards, which equals the cards over the captions when
    the caption keeps its opacity and takes the card's colour by the card's (exact for translucent cards too)."""
    plates = {}
    for path, layers, cards in task:
        canvas = None
        for plate, alpha, dy in layers:
            if plate not in plates:
                with Image.open(plate) as image:
                    plates[plate] = image.convert("RGBA")
            canvas = canvas or Image.new("RGBA", plates[plate].size)
            canvas.alpha_composite(faded(plates[plate], alpha), dest=(0, int(dy)))
        if cards:
            with Image.open(cards) as front:
                card = np.asarray(front.convert("RGBA")).astype(np.float32)
            pixels = np.array(canvas)
            cover = card[..., 3:] / 255
            pixels[..., :3] = np.rint(pixels[..., :3] * (1 - cover) + card[..., :3] * cover)
            canvas = Image.fromarray(pixels, "RGBA")
        canvas.save(path, compress_level=PNG_LEVEL)


def blank_png(size):
    buffer = io.BytesIO()
    Image.new("RGBA", size).save(buffer, format="PNG")
    return buffer.getvalue()


def link_runs(folder, runs):
    """Each (PNG bytes, frame indices) run: the first frame written, the next ones hard links to it, a fresh copy every
    LINKS_PER_FILE; a filesystem without hard links gets copies."""
    for data, indices in runs:
        source, links = None, 0
        for index in indices:
            frame = folder / frame_name(index)
            if source and links < LINKS_PER_FILE:
                try:
                    os.link(source, frame)
                    links += 1
                    continue
                except OSError:
                    pass
            frame.write_bytes(data)
            source, links = frame, 1


def under_frames(sheet, above):
    """{frame: PNG of the cards over the captions} (sheet "under": cards after them in one page, drawn alone in `above`)."""
    return {index: above / frame_name(index) for first, end in sheet["under"] for index in range(first, end)}


def write_frames(sheet, plates, folder, under):
    blanks, settled, moving = [], {}, []
    for index, visible in enumerate(frame_layers(sheet, plates)):
        if not visible:
            blanks.append(index)
        elif index not in under and len(visible) == 1 and visible[0][1:] == (1.0, 0.0):
            settled.setdefault(visible[0][0], []).append(index)
        else:
            moving.append((str(folder / frame_name(index)), visible, under.get(index) and str(under[index])))
    if plates:
        with Image.open(plates[0]) as image:
            size = image.size
    else:
        size = OUTPUT
    runs = [(blank_png(size), blanks), *((plate.read_bytes(), indices) for plate, indices in settled.items())]
    # One task per caption, so each plate is decoded once for its rise and its fade.
    tasks = {}
    for item in moving:
        tasks.setdefault(item[1][0][0], []).append(item)
    tasks = list(tasks.values())
    if not tasks:
        return link_runs(folder, runs)
    # The links (NTFS serialises them per folder, ~1 ms each) are made while the pool draws the motion frames.
    with ProcessPoolExecutor(max_workers=min(len(tasks), DRAW_WORKERS)) as pool:
        drawing = [pool.submit(draw, task) for task in tasks]
        link_runs(folder, runs)
        for task in drawing:
            task.result()


def build(video):
    """frames/<video>.cc/ from its caption sheet, redrawn only when the sheet changed. None without a sheet, or when the
    canvas renderer drew the cards (no HyperFrames key in their folder: it draws the captions in itself). A sheet drawn
    against other HyperFrames cards or plates stops the render: a pass failed between them."""
    sheet_path = WORK / "frames" / f"{video}.cc.json"
    folder, key_file = sheet_path.with_name(f"{video}.cc"), sheet_path.with_name(f"{video}.cc.hash")

    def no_layer():
        # render_final composites frames/<v>.cc/ whenever it exists: a last render's captions would come back.
        shutil.rmtree(folder, ignore_errors=True)
        key_file.unlink(missing_ok=True)

    if not sheet_path.exists():
        return no_layer()
    sheet_bytes = sheet_path.read_bytes()
    sheet = json.loads(sheet_bytes)
    cards, plates_dir, above = (sheet_path.with_name(name) for name in (video, f"{video}.plates", f"{video}.above"))
    if folder_key(cards) is None:
        print(f"{video}: cards not drawn by HyperFrames (captions in), so no caption layer", flush=True)
        return no_layer()
    if (sheet["cards"], sheet["plates"], sheet["above"]) != (folder_key(cards), folder_key(plates_dir), folder_key(above)):
        sys.exit(f"{video}: the caption sheet does not match the card frames or plates; re-run hf/render.js {video}")
    plates = [plates_dir / caption["plate"] for caption in sheet["captions"]]
    under = under_frames(sheet, above)
    # The sheet names the folders' keys, so its bytes cover the plates and the cards over it; this file covers the drawing.
    key = hashlib.sha256(sheet_bytes + DRAWING).hexdigest()
    if key_file.exists() and key_file.read_text(encoding="utf-8") == key and complete(folder, sheet["frames"]):
        return folder
    key_file.unlink(missing_ok=True)
    # Built aside, then swapped in: rewriting a hard-linked frame in place would change every frame linked to it.
    staging = folder.with_name(f"{video}.cc.tmp")
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir()
    # A unique name: an old folder Defender or Explorer still holds must not block the next swap.
    stale = folder.with_name(f"{video}.cc.old-{os.getpid()}-{time.time_ns()}")
    if folder.exists():
        rename_retrying(folder, stale)
    clearing = threading.Thread(target=lambda: [shutil.rmtree(old, True) for old in folder.parent.glob(f"{video}.cc.old*")])
    clearing.start()
    write_frames(sheet, plates, staging, under)
    rename_retrying(staging, folder)
    clearing.join()
    key_file.write_text(key, encoding="utf-8")
    return folder
