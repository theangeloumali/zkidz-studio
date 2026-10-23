// Created by The Angelo Umali.
import { LOOPBACK_HOST } from "@zks/shared";

export function buildSecurityHeaders(previewPort: number): Readonly<Record<string, string>> {
  const contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'",
    // The overlay preview is the only frame the app embeds (plan §9.3).
    `frame-src http://${LOOPBACK_HOST}:${previewPort}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  return {
    "Content-Security-Policy": contentSecurityPolicy,
    // For browsers that ignore frame-ancestors.
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}

export function applySecurityHeaders(headers: Headers, securityHeaders: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
  // The API is same-origin only (plan §11), so no handler may opt a foreign origin in.
  headers.delete("Access-Control-Allow-Origin");
}
