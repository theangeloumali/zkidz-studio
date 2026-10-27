# Created by The Angelo Umali.
# captions.emit_cues writes derived/cues/<video>-cc.json, the only cue format hf reads (plan §7.7).
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import captions
from zks_engine.specs import validate

PHRASES = [{"at": 1.0, "end": 2.0, "text": "kumusta", "reel": 0}, {"at": 2.5, "end": 3.5, "text": "salamat", "reel": 0}]
ENTRIES = [{"ids": [1], "en": "thank you ", "bottom": 1750}, {"ids": [0], "en": "hello"}]


class EmitCuesTests(unittest.TestCase):
    def test_writes_a_json_cue_array_hf_can_load(self):
        with tempfile.TemporaryDirectory() as folder:
            work = Path(folder)
            for sub in ("captions", "cues"):
                (work / sub).mkdir()
            (work / "captions" / "v1.phrases.json").write_text(json.dumps(PHRASES), encoding="utf-8")
            (work / "captions" / "v1.json").write_text(json.dumps(ENTRIES), encoding="utf-8")
            with mock.patch.object(captions, "WORK", work), mock.patch("builtins.print"):
                captions.emit_cues("v1")

            self.assertFalse((work / "cues" / "v1-cc.js").exists())
            self.assertFalse((work / "cues" / "v1-cc.json").exists())
            cues = json.loads((work / "derived" / "cues" / "v1-cc.json").read_text(encoding="utf-8"))
            validate("cue-sheet", cues)
            self.assertEqual(
                cues,
                [
                    {"kind": "caption", "at": 1.0, "end": 2.0, "text": "hello"},
                    {"kind": "caption", "at": 2.5, "end": 3.5, "text": "thank you", "bottom": 1750},
                ],
            )


if __name__ == "__main__":
    unittest.main()
