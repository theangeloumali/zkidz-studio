// Created by The Angelo Umali.
import type { MediaAsset } from "@zks/shared";

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const BYTES_PER_UNIT = 1000;

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDuration(totalSeconds: number): string {
  const whole = Math.round(totalSeconds);
  const hours = Math.floor(whole / SECONDS_PER_HOUR);
  const minutes = Math.floor((whole % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = whole % SECONDS_PER_MINUTE;
  return hours > 0 ? `${hours}:${twoDigits(minutes)}:${twoDigits(seconds)}` : `${minutes}:${twoDigits(seconds)}`;
}

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unitIndex = 0;
  while (value >= BYTES_PER_UNIT && unitIndex < BYTE_UNITS.length - 1) {
    value /= BYTES_PER_UNIT;
    unitIndex += 1;
  }
  const rounded = unitIndex === 0 ? String(value) : value.toFixed(1).replace(/\.0$/, "");
  return `${rounded} ${BYTE_UNITS[unitIndex]}`;
}

function formatFrameRate({ num, den }: NonNullable<MediaAsset["fps"]>): string {
  return `${Number((num / den).toFixed(2))} fps`;
}

/** "1:47 · 3840×2160 · 29.97 fps · HDR"; probing fills these in after the upload lands. */
export function formatMediaMeta(asset: MediaAsset): string {
  const parts = [
    asset.durationS === null ? null : formatDuration(asset.durationS),
    asset.width === null || asset.height === null ? null : `${asset.width}×${asset.height}`,
    asset.fps === null ? null : formatFrameRate(asset.fps),
    asset.isHdr ? "HDR" : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? parts.join(" · ") : "Reading metadata…";
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
