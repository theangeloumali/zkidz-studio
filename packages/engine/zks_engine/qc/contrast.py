# Created by The Angelo Umali.
# Caption contrast (herk gate 2): the caption's text colour against the master pixels in its plate box, per WCAG 2.1.
import numpy as np

MIN_CONTRAST = 4.5  # WCAG 2.1 AA for body text
DEFAULT_BOTTOM = 1430  # the caption component's default bottom on the 1080x1920 grid
PLATE_WIDTH, PLATE_HEIGHT = 893, 150  # 813 px of text plus padding, two lines at most
CANVAS_WIDTH = 1080
CAPTION_TEXT = (255, 255, 255)


def relative_luminance(rgb):
    channels = np.asarray(rgb, np.float64) / 255
    linear = np.where(channels <= 0.03928, channels / 12.92, ((channels + 0.055) / 1.055) ** 2.4)
    return linear @ np.array([0.2126, 0.7152, 0.0722])


def contrast_ratio(first_rgb, second_rgb):
    lighter, darker = sorted((float(relative_luminance(first_rgb)), float(relative_luminance(second_rgb))), reverse=True)
    return (lighter + 0.05) / (darker + 0.05)


def caption_box(bottom):
    return (CANVAS_WIDTH - PLATE_WIDTH) // 2, bottom - PLATE_HEIGHT, PLATE_WIDTH, PLATE_HEIGHT


def caption_contrast(frame, box, text_rgb):
    """Strokes cover a minority of the plate, so the box's median luminance is what the text sits on."""
    x, y, w, h = box
    behind = float(np.median(relative_luminance(frame[y:y + h, x:x + w].reshape(-1, 3))))
    text = float(relative_luminance(text_rgb))
    return (max(text, behind) + 0.05) / (min(text, behind) + 0.05)
