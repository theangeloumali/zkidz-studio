# Created by The Angelo Umali.
# python -m zks_engine.transcribe audio/v3.wav transcripts/v3_words.json [chunks] [language] [model]
import sys
from pathlib import Path

from .. import progress
from . import main

arguments = sys.argv[1:]
with progress.job(Path(arguments[0]).stem, "transcribe"):
    main(arguments[0], arguments[1], int(arguments[2]) if len(arguments) > 2 else 6, arguments[3] if len(arguments) > 3 else "tl",
         arguments[4] if len(arguments) > 4 else None)
