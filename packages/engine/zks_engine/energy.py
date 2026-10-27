# Created by The Angelo Umali.
# Prints a 100 ms RMS strip for a time window, used to see where speech actually sits.
# Usage: python -m zks_engine.energy audio/v1.wav 30 45
import sys

import numpy as np

from .pipeline import load_energy

WINDOW = 0.1
LEVELS = " .:-=+*#%@"


def main(path, start, end):
    energy_db = load_energy(path, WINDOW)
    for row in np.arange(start, end, 10.0):
        cells = energy_db[int(round(row / WINDOW)): int(round(min(row + 10.0, end) / WINDOW))]
        print(f"{row:7.1f} |{''.join(LEVELS[int(np.clip((db + 50) / 35 * 9, 0, 9))] for db in cells)}|")


if __name__ == "__main__":
    main(sys.argv[1], float(sys.argv[2]), float(sys.argv[3]))
