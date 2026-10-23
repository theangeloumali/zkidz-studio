# Created by The Angelo Umali.
# The engine's last line against a spec path escaping the project (§6.8): every input resolves under the project's folders.
import os
import re
from pathlib import Path

from .schema import SpecError

# A video id names files inside work/<kind>/; it can never carry a separator or `..`.
VIDEO_ID = re.compile(r"[A-Za-z0-9][\w-]*")


def inside_project(path, roots, registered=()):
    """The realpath of `path` when it sits under one of `roots` (a folder or a list) or is a registered in-place file;
    SpecError otherwise. Resolving first defeats `..` and symlinks; comparing path parts (not string prefixes) keeps
    `media-evil/` out."""
    resolved = Path(path).resolve()
    folders = [roots] if isinstance(roots, (str, os.PathLike)) else roots
    if any(Path(folder).resolve() in resolved.parents for folder in folders) or resolved in {Path(item).resolve() for item in registered}:
        return resolved
    raise SpecError(f"{resolved} is outside the project (its media and work folders) and is not a registered in-place file")


def video_id(name):
    if not isinstance(name, str) or not VIDEO_ID.fullmatch(name):
        raise SpecError(f"{name!r} is not a video id (letters, digits, _ and -)")
    return name
