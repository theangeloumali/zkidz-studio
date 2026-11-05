# Created by The Angelo Umali.
# YuNet face boxes on the 1080x1920 grid, shared by the learning QC gates and the frame-faces command.
# In footage with several people, the presenter is the largest face: the one nearest the camera.
import json
import subprocess

import numpy as np

from . import ffio, pipeline
from .home import data_dir
from .specs import SpecError
from .transcribe.whispercpp import SETUP_FIX, load_lock

MODEL = "yunet"
DETECT_SIZE = (540, 960)  # half the grid: four times cheaper, and a presenter's face is still ~100 px wide
MIN_SCORE = 0.6
GRID_SCALE = pipeline.OUTPUT[0] / DETECT_SIZE[0]
CANVAS_SCALE = 0.5  # sources/<v>.bands.json is on the 2160x3840 canvas
BLACK = 12  # a letterbox row's brightest mean over the samples (0-255): pad=black plus encoder noise
MAX_FPS = 4
DETECT_THREADS = 2  # OpenCV's default pool burns ~4x the CPU for half the wall time on this shared machine


def model_path(lock=None):
    pin = (lock or load_lock())["models"][MODEL]
    path = data_dir("models") / pin["file"]
    if not path.is_file():
        raise ffio.ToolMissing(f"the face checks need YuNet ({pin['file']}), which is not in {data_dir('models')}. {SETUP_FIX}")
    return path


def detector(size=DETECT_SIZE):
    import cv2

    cv2.setNumThreads(DETECT_THREADS)
    return cv2.FaceDetectorYN.create(str(model_path()), "", size, MIN_SCORE)


def ranked(rows, scale):
    """YuNet rows as [{box, score}] on the grid (clamped inside it), largest first."""
    width, height = pipeline.OUTPUT
    found = []
    for row in rows:
        x, y, w, h = (float(value) * scale for value in row[:4])
        x0, y0, x1, y1 = max(0.0, x), max(0.0, y), min(width, x + w), min(height, y + h)
        found.append({"box": [round(x0), round(y0), round(x1 - x0), round(y1 - y0)], "score": round(min(1.0, max(0.0, float(row[-1]))), 3)})
    return sorted(found, key=lambda face: face["box"][2] * face["box"][3], reverse=True)


def detect(model, image, scale=GRID_SCALE):
    _, rows = model.detect(np.ascontiguousarray(image))
    return ranked([] if rows is None else rows, scale)


def presenter(found):
    return found[0]["box"] if found else None


def frames(path, fps, start=0.0, duration=None, size=DETECT_SIZE):
    """BGR frames of `size` at `fps` from `start` seconds, one at a time, so a long source never sits in memory."""
    width, height = size
    command = [ffio.ffmpeg_bin(), "-v", "error", "-nostdin", "-ss", f"{start:.6f}", *ffio.user_input_args(path),
               *(["-t", f"{duration:.6f}"] if duration else []), "-vf", f"fps={fps},scale={width}:{height}:flags=area",
               "-an", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    frame_bytes = width * height * 3
    with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as process:
        while len(data := process.stdout.read(frame_bytes)) == frame_bytes:
            yield np.frombuffer(data, np.uint8).reshape(height, width, 3)
        error = process.stderr.read().decode("utf-8", "replace").strip()
    if process.returncode:
        raise RuntimeError(f"ffmpeg could not sample {path}: {error or f'exit {process.returncode}'}")


def band_from_profile(rows, columns, scale):
    """The picture inside black bars, from each row's and column's brightest mean over the samples; all black keeps the frame."""
    lit_rows, lit_columns = np.flatnonzero(rows > BLACK), np.flatnonzero(columns > BLACK)
    if not len(lit_rows) or not len(lit_columns):
        return [0, 0, *pipeline.OUTPUT]
    top, bottom, left, right = lit_rows[0], lit_rows[-1] + 1, lit_columns[0], lit_columns[-1] + 1
    return [round(left * scale), round(top * scale), round((right - left) * scale), round((bottom - top) * scale)]


def recorded_bands(work, video):
    """The join's band per clip, [{at, end, band}] in source seconds on the 4K canvas; [] without a record."""
    record = work / "sources" / f"{video}.bands.json"
    return json.loads(record.read_text(encoding="utf-8")) if record.is_file() else []


def recorded_band(work, video, at):
    """The join's own band for the clip under `at`, on the 1080 grid, or None without a record."""
    clips = recorded_bands(work, video)
    if not clips:
        return None
    clip = next((clip for clip in clips if clip["at"] <= at < clip["end"]), clips[0] if clips else None)
    return None if clip is None else [round(value * CANVAS_SCALE) for value in clip["band"]]


def frame_faces(video, at=None, end=None, fps=1.0):
    """The frame_faces tool's report: faces in the proxy at `fps` over at..end (source seconds) and the picture band."""
    proxy = pipeline.WORK / "mezz" / f"{video}.mp4"
    if not proxy.is_file():
        raise SpecError(f"{video} has no proxy at work/mezz/{video}.mp4; ingest it first")
    duration = ffio.probe(proxy)["durationS"]
    start, stop = at or 0.0, min(duration, end if end is not None else duration)
    if stop <= start:
        raise SpecError(f"end must be after at, inside the {duration:.2f} s source")
    model, samples = detector(), []
    rows, columns = np.zeros(DETECT_SIZE[1]), np.zeros(DETECT_SIZE[0])
    for index, image in enumerate(frames(proxy, fps, start, stop - start)):
        gray = image.mean(axis=2)
        rows, columns = np.maximum(rows, gray.mean(axis=1)), np.maximum(columns, gray.mean(axis=0))
        samples.append({"t": round(start + index / fps, 3), "faces": detect(model, image)})
    band = recorded_band(pipeline.WORK, video, start) or band_from_profile(rows, columns, GRID_SCALE)
    return {"band": band, "samples": samples}
