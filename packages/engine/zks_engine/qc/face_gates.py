# Created by The Angelo Umali.
# The learning theme's face gates on the master: no overlay pixel on the presenter's face (faceClear), and the widest face
# against the bar (faceWidth). A faceWidth problem is footage framing, the owner's call, never fixed by covering the face.
import numpy as np

from .. import faces
from ..pipeline import OUTPUT, cue_spans
from . import inputs, people_gates, timeline

FACE_CLEAR, FACE_WIDTH = 0.005, 0.25  # share of the face box covered; widest face over the frame width
FACE_FPS, NEIGHBOURS = 5, 2  # sampling rate; +-frames a sample may land off the overlay grid
OPAQUE = 128


def presenter_box(image, found, frosted_out):
    """The largest face in `found` (grid boxes on a detection-size `image`). With everyone else blurred, a frosted face is
    never his: on the OnePuhunan master frosted faces read 5-20 and sharp ones 204 and up."""
    if frosted_out:
        found = [face for face in found if people_gates.face_detail(image, [value / faces.GRID_SCALE for value in face["box"]]) >= people_gates.READABLE]
    return faces.presenter(found)


def master_faces(master, frosted_out=False):
    """(master seconds, the presenter's box or None) at FACE_FPS."""
    model = faces.detector()
    return [(index / FACE_FPS, presenter_box(image, faces.detect(model, image), frosted_out)) for index, image in enumerate(faces.frames(master, FACE_FPS))]


def least_cover(box, frames, enough=0.0):
    """The least share of `box` covered across neighbour frames, each a list of alpha layers that add up; `frames` is lazy,
    so reading stops at the first frame covered no more than `enough`."""
    x, y, w, h = box
    least = 1.0
    for layers in frames:
        height, width = layers[0].shape
        x0, y0, x1, y1 = max(0, x), max(0, y), min(width, x + w), min(height, y + h)
        covered = np.zeros((max(0, y1 - y0), max(0, x1 - x0)), bool)
        for alpha in layers:
            covered |= alpha[y0:y1, x0:x1] > OPAQUE
        least = min(least, float(covered.mean()) if covered.size else 0.0)
        if least <= enough:
            break
    return least


class MissingFrame(Exception):
    pass


def overlay_layers(video, frame):
    """The overlay's alpha, and the caption layer's when drawn as frames, at an edited frame."""
    import cv2

    captions = inputs.work() / "frames" / f"{video}.cc"
    paths = [inputs.work() / "frames" / video / f"{frame:05d}.png"] + ([captions / f"{frame:05d}.png"] if captions.is_dir() else [])
    layers = []
    for path in paths:
        image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED) if path.is_file() else None
        if image is None or image.ndim < 3 or image.shape[2] < 4:
            raise MissingFrame(f"{path.relative_to(inputs.work()).as_posix()} is not an RGBA overlay frame; re-render the overlays before QC")
        layers.append(image[:, :, 3])
    return layers


def face_clear_problems(video, cues, edl, intro, split_frames, found):
    """Every sampled face outside the footage cards (the card is his face) and the brand split (it opens over him on purpose)."""
    if not any(box for _, box in found):
        return ["no face found in the master: nothing proven"], "no face"
    rate = timeline.rate(edl)
    cards = [span for cue in cues if cue["kind"] == "footageCard" for span in cue_spans(cue["at"], cue.get("end", cue["at"]), edl)]
    cards += inputs.cover_spans(cues, edl)  # under paper or a cutaway he is off screen
    measured = []
    for seconds, box in found:
        frame = timeline.edited_frame(round(seconds * rate), intro)
        if box is None or frame is None or frame >= edl["frames"] or any(start <= frame / rate < stop for start, stop in cards):
            continue
        if intro and intro["at"] <= frame < intro["at"] + split_frames:
            continue
        # The centre frame first: most samples are clear there, and reading stops at the first clear neighbour.
        near = [at for step in range(NEIGHBOURS + 1) for at in dict.fromkeys((frame - step, frame + step)) if 0 <= at < edl["frames"]]
        try:
            measured.append((least_cover(box, (overlay_layers(video, at) for at in near), FACE_CLEAR), round(frame / rate, 2)))
        except MissingFrame as error:
            return [str(error)], "overlay frames missing"
    if not measured:
        return ["no frame outside the footage cards and the split to measure"], "nothing measured"
    over = sorted((at, share) for share, at in measured if share > FACE_CLEAR)
    worst = max(measured)
    summary = f"{len(measured)} frames measured; worst {worst[0]:.4f} at {worst[1]}s (limit {FACE_CLEAR})"
    if not over:
        return [], summary
    listed = ", ".join(f"{at}s {share:.3f}" for at, share in over[:10])
    return [f"an overlay covers the presenter's face ({listed}{', …' if len(over) > 10 else ''}); move it above the face box"], summary


def face_width_problems(found):
    boxes = [box for _, box in found if box]
    if not boxes:
        return ["no face found in the master"], "no face"
    widest = max(box[2] for box in boxes) / OUTPUT[0]
    # The median box places graphics: over footage they stay above its top (the hairline sits ~80 px higher).
    x, y, w, h = (int(value) for value in np.median(np.array(boxes), axis=0))
    summary = f"max {widest:.3f} of the width (limit {FACE_WIDTH}); median face x {x}-{x + w}, y {y}-{y + h} on 1080x1920"
    if widest <= FACE_WIDTH:
        return [], summary
    return [f"the face is {widest:.3f} of the frame width (bar {FACE_WIDTH}): footage framing, the owner's call; never cover the face to pass it"], summary
