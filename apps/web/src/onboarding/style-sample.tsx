// Created by The Angelo Umali.
import { STYLE_SAMPLE_SECONDS, type Cue, type StyleCard } from "@zks/shared";
import { useEffect, useState, type CSSProperties } from "react";
import "./style-sample.css";

export const SAMPLE_MS = STYLE_SAMPLE_SECONDS * 1000;

type PlayState = "false" | "true" | "done";

interface StyleSampleProps {
  readonly style: StyleCard;
  /** Bumped by the card to replay; 0 means show the settled frame. */
  readonly playCount: number;
}

/** Draws the preset's own sample cue sheet; at rest it shows every cue settled, so nothing moves until asked. */
export function StyleSample({ style, playCount }: StyleSampleProps) {
  // Derived, not set in the effect: the play state is "done" once this replay's timer has fired.
  const [finishedCount, setFinishedCount] = useState(0);
  const playState: PlayState = playCount === 0 ? "false" : finishedCount === playCount ? "done" : "true";

  useEffect(() => {
    if (playCount === 0) return;
    const timer = setTimeout(() => setFinishedCount(playCount), SAMPLE_MS);
    return () => clearTimeout(timer);
  }, [playCount]);

  return (
    <figure aria-label={`${style.name} sample`} data-style={style.id} data-playing={playState} className="style-sample m-0 flex w-full flex-col gap-2">
      {/* Remounting on each replay restarts the CSS animations from their first frame. */}
      <div key={playCount} className="style-sample-stage" aria-hidden="true">
        {style.sample.map((cue, index) => (
          <SampleCue key={index} cue={cue} />
        ))}
      </div>
      <div key={`progress-${playCount}`} className="style-sample-progress" aria-hidden="true">
        <span className="style-sample-fill" />
      </div>
    </figure>
  );
}

/** Each cue enters at its `at` and leaves at its `end`, read by the play animations in style-sample.css. */
function cueTiming(cue: Cue): CSSProperties {
  return { "--cue-at": `${cue.at}s`, "--cue-end": `${cue.end}s` } as CSSProperties;
}

/** The kinds a style sample uses; the engine renders the rest, so the preview skips them. */
function SampleCue({ cue }: { readonly cue: Cue }) {
  switch (cue.kind) {
    case "hookTitle":
      return (
        <div className="style-sample-cue style-sample-hook" style={cueTiming(cue)}>
          {cue.kicker && <span className="style-sample-kicker">{cue.kicker}</span>}
          {cue.lines.map((line, index) => (
            <span key={index} className={`style-sample-line ${index === cue.accentLine ? "style-sample-gold" : "style-sample-white"}`}>
              {line}
            </span>
          ))}
          <span className="style-sample-rule" />
        </div>
      );
    case "slamStamp":
      return (
        <span className="style-sample-cue style-sample-stamp" style={cueTiming(cue)}>
          {cue.text}
        </span>
      );
    case "caption":
      return (
        <p className="style-sample-cue style-sample-caption m-0" style={cueTiming(cue)}>
          {cue.text}
        </p>
      );
    default:
      return null;
  }
}
