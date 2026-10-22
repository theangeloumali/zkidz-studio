# Created by The Angelo Umali.
"""ZKidz Studio render engine."""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("zks-engine")
except PackageNotFoundError:  # a source checkout run without `uv sync`
    __version__ = "0.0.0"
