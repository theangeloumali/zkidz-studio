# Created by The Angelo Umali.
# Word-timing JSONL -> readable transcript, one line per phrase (breaks at pauses >= 0.6 s or 14 words).
# Usage (from the work dir): python -m zks_engine.readable transcripts/v4_words.json > transcripts/v4_readable.txt
import json
import sys


def main(path):
    words = [json.loads(line) for line in open(path, encoding="utf-8") if line.strip()]
    line, start, last_end = [], None, None
    for word in words:
        if line and (word["start"] - last_end >= 600 or len(line) >= 14):
            print(f"[{start / 1000:7.2f}] {' '.join(line)}")
            line = []
        if not line:
            start = word["start"]
        line.append(word["text"].strip())
        last_end = word["end"]
    if line:
        print(f"[{start / 1000:7.2f}] {' '.join(line)}")


if __name__ == "__main__":
    main(sys.argv[1])
