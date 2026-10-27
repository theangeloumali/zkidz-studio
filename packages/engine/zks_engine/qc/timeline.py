# Created by The Angelo Umali.
# Edited frames vs master frames and source frames: the master carries the brand intro spliced in at its insert frame.


def rate(edl):
    return edl["fps_num"] / edl["fps_den"]


def cut_frames(edl):
    """Edited frames where a cut lands: the start of every kept segment after the first."""
    return [seg["target"] for seg in edl["segments"][1:]]


def master_frame(edited_frame, intro):
    """The master's frame for an edited frame; the intro's frames sit in front of everything from its insert on."""
    return edited_frame + intro["frames"] if intro and edited_frame >= intro["at"] else edited_frame


def master_seconds(edited_frame, edl, intro):
    return master_frame(edited_frame, intro) / rate(edl)


def segment_at(edited_frame, edl):
    return next((seg for seg in edl["segments"] if seg["target"] <= edited_frame < seg["target"] + seg["out"] - seg["in"]), None)


def source_frame(edited_frame, edl):
    """The source frame an edited frame shows, or None past the edit's end."""
    seg = segment_at(edited_frame, edl)
    return None if seg is None else seg["in"] + edited_frame - seg["target"]
