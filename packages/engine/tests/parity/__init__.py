# Created by The Angelo Umali.
# Render parity (plan §14 Phase 3, slice 3c): the CPU golden render and the GPU-vs-CPU comparison.
import os

from zks_engine.home import data_dir

# Read before support.py swaps in a scratch ZKS_HOME: a hardware render must queue on the machine's real gpu slot.
MACHINE_LOCKS = os.environ.get("ZKS_LOCKS") or data_dir("locks")
