# Created by The Angelo Umali.
# Where the engine keeps machine data (models, locks, progress): ZKS_HOME, else the OS data dir (plan §5).
import os
import sys
from pathlib import Path

APP_DIR = "zkidz-studio"


def zks_home(platform=sys.platform):
    if os.environ.get("ZKS_HOME"):
        return Path(os.environ["ZKS_HOME"])
    if platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / APP_DIR
    if platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_DIR
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / APP_DIR


def data_dir(name):
    """ZKS_HOME/<name>, or the ZKS_<NAME> override (tests point locks and progress at scratch folders)."""
    return Path(os.environ.get(f"ZKS_{name.upper()}") or zks_home() / name)
