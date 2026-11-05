// Created by The Angelo Umali.
import { THEME_TYPE_ROLES, type ProjectStyle, type ThemeId } from "@zks/shared";

export const THEME_LABELS: Readonly<Record<ThemeId, string>> = { zkidz: "ZKidz", minimal: "Minimal", learning: "v2 Live Motion (learning vlog)" };

const SFX_LABELS = { none: "No sound effects", light: "Light sound effects", "every-cut": "A sound on every cut" } as const;
const ROLE_LABELS = { display: "Display", body: "Body", label: "Label", kicker: "Kicker", hand: "Hand-lettered", mono: "Mono" } as const;

function paceLabel(shotLengthS: number): string {
  return `About ${Number(shotLengthS.toFixed(1))} s per shot`;
}

/** What the project looks like now; rows appear only for what the style overrides. */
export function StyleLook({ style }: { readonly style: ProjectStyle }) {
  const tokens = Object.entries(style.tokens ?? {});
  const fonts = THEME_TYPE_ROLES.flatMap((role) => {
    const family = style.type?.[role];
    return family === undefined ? [] : [{ role, family }];
  });

  return (
    <div role="group" aria-label="Current look">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
        <dt className="text-label font-semibold text-copy-muted">Theme</dt>
        <dd className="text-ui">{THEME_LABELS[style.theme]}</dd>
        {tokens.length > 0 && (
          <>
            <dt className="text-label font-semibold text-copy-muted">Colours</dt>
            <dd>
              <ul className="flex flex-wrap gap-x-4 gap-y-2">
                {tokens.map(([name, hex]) => (
                  <li key={name} className="flex items-center gap-2 text-ui-sm">
                    {/* The swatch paints the style's own value; the name and hex beside it carry the meaning. */}
                    <span aria-hidden="true" className="size-5 rounded-field border border-line-strong" style={{ backgroundColor: hex }} />
                    <span>{name}</span>
                    <span className="font-mono text-copy-muted">{hex}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {fonts.length > 0 && (
          <>
            <dt className="text-label font-semibold text-copy-muted">Fonts</dt>
            <dd>
              <ul className="flex flex-col gap-1 text-ui-sm">
                {fonts.map(({ role, family }) => (
                  <li key={role} className="flex gap-2">
                    <span className="text-copy-muted">{ROLE_LABELS[role]}</span>
                    <span>{family}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {style.sfx !== undefined && (
          <>
            <dt className="text-label font-semibold text-copy-muted">Sound</dt>
            <dd className="text-ui">{SFX_LABELS[style.sfx]}</dd>
          </>
        )}
        {style.shotLengthS !== undefined && (
          <>
            <dt className="text-label font-semibold text-copy-muted">Pace</dt>
            <dd className="text-ui">{paceLabel(style.shotLengthS)}</dd>
          </>
        )}
        {style.boil !== undefined && (
          <>
            <dt className="text-label font-semibold text-copy-muted">Hand-drawn wobble</dt>
            <dd className="text-ui">{style.boil ? "On" : "Off"}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
