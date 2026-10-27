// Created by The Angelo Umali.
// One byte range per request is all a <video> element asks for; anything else gets the whole file.
export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;

export function parseByteRange(rangeHeader: string | undefined, fileSize: number): ByteRange | "unsatisfiable" | null {
  const match = rangeHeader === undefined ? null : SINGLE_RANGE.exec(rangeHeader.trim());
  if (match === null) return null;
  const [, rawStart = "", rawEnd = ""] = match;
  if (rawStart === "" && rawEnd === "") return null;

  if (rawStart === "") {
    const suffixLength = Number(rawEnd);
    if (suffixLength === 0 || fileSize === 0) return "unsatisfiable";
    return { start: Math.max(0, fileSize - suffixLength), end: fileSize - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd === "" ? fileSize - 1 : Math.min(Number(rawEnd), fileSize - 1);
  if (rawEnd !== "" && Number(rawEnd) < start) return null;
  if (start >= fileSize) return "unsatisfiable";
  return { start, end };
}
