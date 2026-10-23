# Created by The Angelo Umali.
# The engine's last line against a spec path escaping the project (§6.8): every input resolves under the media folder.
from pathlib import Path

from .schema import SpecError


def inside_project(path, media_dir, registered=()):
    """The realpath of `path` when it sits under `media_dir` or is a registered in-place file; SpecError otherwise.
    Resolving first defeats `..` and symlinks; comparing path parts (not string prefixes) keeps `media-evil/` out."""
    resolved = Path(path).resolve()
    root = Path(media_dir).resolve()
    if root in resolved.parents or resolved in {Path(item).resolve() for item in registered}:
        return resolved
    raise SpecError(f"{resolved} is outside the project media folder")
