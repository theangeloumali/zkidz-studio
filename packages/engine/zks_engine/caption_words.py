# Created by The Angelo Umali.
# Word-state captions for the learning theme: each entry builds word by word into lines of 1-4 words, timed by whisper
# for English speech or shared out by character count, with accent keyword pills (the hf caption component draws them).
import string


# Word captions: the learning theme's caption tokens (size, line width, pill padding).
WORD_SIZE, WORD_LINE_PX, WORD_PILL_PAD = 60, 900, 12
GROUP_WORDS = 4
SCALES = (0.6, 2.0)
# Chakra Petch SemiBold advances in em, measured with brand/fonts.js advanceWidth at 1000 px. Summed without kerning they run
# a little wide, so a line breaks early rather than past the renderer's refusal; an unlisted character counts as the widest.
CHAR_EM = {
    " ": 0.263, "!": 0.264, '"': 0.42, "#": 0.707, "$": 0.629, "%": 0.859, "&": 0.654, "'": 0.236, "(": 0.335, ")": 0.335,
    "*": 0.346, "+": 0.556, ",": 0.227, "-": 0.422, ".": 0.227, "/": 0.503, "0": 0.644, "1": 0.374, "2": 0.566, "3": 0.595,
    "4": 0.571, "5": 0.598, "6": 0.614, "7": 0.514, "8": 0.63, "9": 0.619, ":": 0.223, ";": 0.223, "<": 0.606, "=": 0.556,
    ">": 0.606, "?": 0.552, "@": 0.827, "A": 0.637, "B": 0.662, "C": 0.647, "D": 0.68, "E": 0.598, "F": 0.568, "G": 0.668,
    "H": 0.69, "I": 0.266, "J": 0.572, "K": 0.64, "L": 0.553, "M": 0.793, "N": 0.689, "O": 0.692, "P": 0.638, "Q": 0.692,
    "R": 0.667, "S": 0.629, "T": 0.576, "U": 0.692, "V": 0.642, "W": 0.874, "X": 0.636, "Y": 0.62, "Z": 0.584, "[": 0.332,
    "\\": 0.518, "]": 0.332, "^": 0.65, "_": 0.462, "`": 0.24, "a": 0.567, "b": 0.593, "c": 0.55, "d": 0.595, "e": 0.576,
    "f": 0.392, "g": 0.595, "h": 0.586, "i": 0.263, "j": 0.278, "k": 0.553, "l": 0.253, "m": 0.853, "n": 0.584, "o": 0.585,
    "p": 0.595, "q": 0.588, "r": 0.401, "s": 0.528, "t": 0.406, "u": 0.583, "v": 0.501, "w": 0.722, "x": 0.515, "y": 0.585,
    "z": 0.49, "{": 0.366, "|": 0.254, "}": 0.366, "~": 0.578, "\u2018": 0.225, "\u2019": 0.225, "\u201c": 0.412,
    "\u201d": 0.412, "\u2026": 0.682, "\u2013": 0.632, "\u2014": 0.743, "\u00b7": 0.227,
}
WIDEST_EM = max(CHAR_EM.values())
PUNCTUATION = string.punctuation + "\u2018\u2019\u201c\u201d\u2026\u2013\u2014"


def bare(word):
    return word.strip(PUNCTUATION).lower()


def pill_indexes(words, pills):
    """Each pill's word in `words` (the first occurrence not yet taken, punctuation and case aside), and the pills missing."""
    taken, missing = [], []
    for pill in pills:
        index = next((i for i, word in enumerate(words) if bare(word) == bare(pill) and i not in taken), None)
        if index is None:
            missing.append(pill)
        else:
            taken.append(index)
    return sorted(taken), missing


def line_px(words, pills, indexes, scale):
    text = " ".join(words[i] for i in indexes)
    return sum(CHAR_EM.get(char, WIDEST_EM) for char in text) * WORD_SIZE * scale + 2 * WORD_PILL_PAD * sum(i in pills for i in indexes)


def word_groups(words, pills, scale):
    """Greedy lines of at most GROUP_WORDS words that fit WORD_LINE_PX at the entry's scale."""
    groups = [[]]
    for index in range(len(words)):
        candidate = groups[-1] + [index]
        if groups[-1] and (len(candidate) > GROUP_WORDS or line_px(words, pills, candidate, scale) > WORD_LINE_PX):
            groups.append([index])
        else:
            groups[-1] = candidate
    return groups


def check_words(entry, ids):
    problems, words = [], entry.get("en", "").split()
    scale = entry.get("scale", 1)
    if isinstance(scale, bool) or not isinstance(scale, (int, float)) or not SCALES[0] <= scale <= SCALES[1]:
        return [f"ids {ids} scale {scale!r} is not in {SCALES[0]}-{SCALES[1]}"]
    pills, missing = pill_indexes(words, entry.get("pills", []))
    problems += [f"ids {ids} pill {pill!r} is not a word in {entry.get('en')!r}" for pill in missing]
    problems += [f"ids {ids} word {words[i]!r} is wider than one line at scale {scale}" for i in range(len(words))
                 if line_px(words, pills, [i], scale) > WORD_LINE_PX]
    return problems


def spoken_run(entry, phrases, transcript):
    """Whisper's words for the entry when its English is what was said (English speech), else None. `transcript()` gives
    (words, their bare forms)."""
    said = [bare(word) for i in entry["ids"] for word in phrases[i]["text"].split()]
    if said != [bare(word) for word in entry["en"].split()]:
        return None
    words, bares = transcript()
    runs = [i for i in range(len(words) - len(said) + 1) if bares[i:i + len(said)] == said]
    if not runs:
        return None
    nearest = min(runs, key=lambda i: abs(words[i]["start"] - phrases[entry["ids"][0]]["at"]))
    return words[nearest:nearest + len(said)]


def word_starts(words, span, spoken):
    """When each word appears: whisper's start for English speech, else the span shared out by character count."""
    start, end = span
    if spoken:
        return [start] + [min(max(word["start"], start), end) for word in spoken[1:]]
    chars = [len(word) for word in words]
    return [start + (end - start) * sum(chars[:i]) / sum(chars) for i in range(len(words))]


def word_cues(entry, phrases, transcript, bottom):
    """One caption per word state: the words so far of its line, ending where the next word (or the entry) does.
    `bottom` is the plate bottom an entry without its own takes."""
    words = entry["en"].split()
    scale = entry.get("scale", 1)
    pills, _ = pill_indexes(words, entry.get("pills", []))
    span = (phrases[entry["ids"][0]]["at"], phrases[entry["ids"][-1]]["end"])
    starts = word_starts(words, span, spoken_run(entry, phrases, transcript))
    cues = []
    for group in word_groups(words, pills, scale):
        line = " ".join(words[i] for i in group)
        line_pills = [i - group[0] for i in pills if i in group]
        for count, index in enumerate(group, 1):
            end = starts[index + 1] if index + 1 < len(words) else span[1]
            cues.append({"kind": "caption", "style": "words", "at": round(starts[index], 3), "end": round(end, 3),
                         "text": " ".join(words[i] for i in group[:count]), "line": line, "pills": line_pills, "scale": scale}
                        | {"bottom": entry.get("bottom", bottom)})
    return cues
