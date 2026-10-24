# Created by The Angelo Umali.
# The master's gates other than motion and words: format, frame count, loudness, caption contrast, hook mouth, lip sync.
# Each returns the problems it found; an empty list passes.
from ..pipeline import loudness, probe_video, source_to_edited
from ..render_final import count_frames
from ..specs import gates
from ..specs.gates import GateFailed
from . import contrast, inputs, lipsync, media, motion, mouth, timeline

MASTER_SIZES = {(1080, 1920), (2160, 3840)}
MASTER_CODECS = {"h264", "hevc"}


def format_problems(master):
    stream = probe_video(master)
    problems = []
    if (stream["width"], stream["height"]) not in MASTER_SIZES:
        problems.append(f"{stream['width']}x{stream['height']} is not a 1080x1920 or 2160x3840 portrait master")
    if stream["codec_name"] not in MASTER_CODECS:
        problems.append(f"codec {stream['codec_name']} is not H.264 or HEVC")
    if any(data.get("side_data_type") == "Display Matrix" for data in stream.get("side_data_list", [])):
        problems.append("the master carries rotation side data; players would turn it")
    return problems


def frame_problems(master, edl, intro):
    expected = edl["frames"] + (intro["frames"] if intro else 0)
    actual = count_frames(master)
    return [] if actual == expected else [f"the master has {actual} frames; the EDL needs {expected}"]


def loudness_problems(master):
    try:
        gates.check_loudness(*loudness(master))
    except GateFailed as error:
        return [str(error)]
    return []


def caption_problems(video, master, edl, intro):
    problems = []
    for cue in inputs.caption_cues(video):
        try:
            edited_s = source_to_edited((cue["at"] + cue["end"]) / 2, edl)
        except ValueError:
            continue  # the caption's middle was cut, so the edit drops it
        frame = timeline.master_frame(round(edited_s * timeline.rate(edl)), intro)
        box = contrast.caption_box(cue.get("bottom", contrast.DEFAULT_BOTTOM))
        ratio = contrast.caption_contrast(media.rgb_frame(master, frame, inputs.fps_of(edl)), box, contrast.CAPTION_TEXT)
        if ratio < contrast.MIN_CONTRAST:
            problems.append(f"caption '{cue['text']}' at {edited_s:.2f} s has {ratio:.1f}:1 contrast; it needs {contrast.MIN_CONTRAST}:1 (add a plate or move it)")
    return problems


def mouth_problems(video, edl, intro, spec):
    frames = mouth.hook_frames(edl, intro, inputs.facecam_spans(spec))
    if not frames:
        return []
    alpha = media.overlay_alpha(inputs.work() / "frames" / video, max(frames) + 1, inputs.fps_of(edl))
    return mouth.mouth_problems(alpha, frames, edl)


def cut_offsets(master, source, seg, master_at, edl):
    """(video offset, audio offset, both confident) just after one cut."""
    fps, rate = inputs.fps_of(edl), timeline.rate(edl)
    reach_s = lipsync.REACH / rate
    video_offset, video_sure = lipsync.video_offset(
        media.gray_frames(master, master_at, lipsync.MATCH_FRAMES, fps, motion.SUBJECT_REGION),
        media.gray_frames(source, seg["in"] + lipsync.LEAD_IN - lipsync.REACH, lipsync.MATCH_FRAMES + 2 * lipsync.REACH, fps, motion.SUBJECT_REGION))
    audio_offset, audio_sure = lipsync.audio_offset(
        media.mono_audio(master, master_at / rate, lipsync.AUDIO_S),
        media.mono_audio(source, (seg["in"] + lipsync.LEAD_IN) / rate - reach_s, lipsync.AUDIO_S + 2 * reach_s),
        media.QC_AUDIO_RATE, reach_s, rate)
    return video_offset, audio_offset, video_sure and audio_sure


def lip_sync_problems(master, source, edl, intro):
    rate = timeline.rate(edl)
    needed = lipsync.LEAD_IN + round(lipsync.AUDIO_S * rate) + lipsync.REACH
    problems = []
    for seg in edl["segments"][1:]:
        edited = seg["target"] + lipsync.LEAD_IN
        if seg["out"] - seg["in"] < needed or seg["in"] + lipsync.LEAD_IN < lipsync.REACH:
            continue  # too short to time
        if intro and edited <= intro["at"] < edited + needed:
            continue  # the intro splits the stretch being matched
        video_offset, audio_offset, sure = cut_offsets(master, source, seg, timeline.master_frame(edited, intro), edl)
        if sure and lipsync.is_slipped(video_offset, audio_offset):
            problems.append(f"cut at {seg['target'] / rate:.2f} s: the audio is {audio_offset - video_offset:+.2f} frames off the picture")
    return problems
