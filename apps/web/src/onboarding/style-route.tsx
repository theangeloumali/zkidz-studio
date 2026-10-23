// Created by The Angelo Umali.
import { useMutation, useQuery } from "@tanstack/react-query";
import { API_ROUTES, type StyleCard as ShippedStyle, type StyleId } from "@zks/shared";
import { ChevronRight, Play } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { requestJson } from "../api/client.ts";
import { fetchStylePresets, onboardingQueryKeys } from "../api/onboarding-client.ts";
import { buttonClass } from "../components/button-class.ts";
import { ROUTE_PATHS } from "../lib/routes.ts";
import { StyleSample } from "./style-sample.tsx";

const { getStyle, setStyle } = API_ROUTES;
/** The server's default too; shown while the saved choice loads or when none is saved. */
const DEFAULT_STYLE_ID: StyleId = "zkidz";

async function fetchStyleId(): Promise<StyleId> {
  const { styleId } = await requestJson(getStyle.response, getStyle.path);
  return styleId;
}

function saveStyleId(styleId: StyleId) {
  return requestJson(setStyle.response, setStyle.path, { method: setStyle.method, body: { styleId } });
}

/** Setup's optional style step (plan §9.1): each card plays the same 5 s sample in its style. */
export function StyleRoute() {
  const navigate = useNavigate();
  // A missing saved style is the normal first run, so a failed read falls back to the default.
  const saved = useQuery({ queryKey: ["style"], queryFn: fetchStyleId });
  const styles = useQuery({ queryKey: onboardingQueryKeys.stylePresets, queryFn: fetchStylePresets });
  const [picked, setPicked] = useState<StyleId | null>(null);
  const [playCounts, setPlayCounts] = useState<Partial<Record<StyleId, number>>>({});
  const chosen = picked ?? saved.data ?? DEFAULT_STYLE_ID;
  const save = useMutation({ mutationFn: saveStyleId, onSuccess: () => navigate(ROUTE_PATHS.home) });

  function play(styleId: StyleId) {
    setPlayCounts((counts) => ({ ...counts, [styleId]: (counts[styleId] ?? 0) + 1 }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate(chosen);
  }

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <p className="text-label font-semibold text-copy-muted uppercase">Setup · optional</p>
        <h1 className="font-display text-h2 font-extrabold uppercase font-condensed">Pick a style</h1>
        <p className="max-w-[65ch] text-lede text-copy-muted">
          A style sets the title cards, caption plate and sound. Each card plays the same 5-second sample in that style.
        </p>
      </header>
      <fieldset className="m-0 grid grid-cols-1 gap-4 border-0 p-0 md:grid-cols-3">
        <legend className="sr-only">Styles</legend>
        {styles.data?.map((style) => (
          <StyleCard
            key={style.id}
            style={style}
            isSelected={chosen === style.id}
            playCount={playCounts[style.id] ?? 0}
            onSelect={() => {
              setPicked(style.id);
              play(style.id);
            }}
            onPlay={() => play(style.id)}
          />
        ))}
      </fieldset>
      {styles.isError && (
        <p role="alert" className="text-ui text-danger">
          {styles.error.message}
        </p>
      )}
      {save.isError && (
        <p role="alert" className="text-ui text-danger">
          {save.error.message}
        </p>
      )}
      <div className="flex justify-end">
        <button type="submit" className={buttonClass("primary")} disabled={save.isPending}>
          Use this style
          <ChevronRight aria-hidden="true" className="size-4" />
        </button>
      </div>
    </form>
  );
}

interface StyleCardProps {
  readonly style: ShippedStyle;
  readonly isSelected: boolean;
  readonly playCount: number;
  readonly onSelect: () => void;
  readonly onPlay: () => void;
}

// dry-new: setup/choice-card.tsx hardcodes its radio name and a row layout; this card needs a 9:16 preview and a replay control.
function StyleCard({ style, isSelected, playCount, onSelect, onPlay }: StyleCardProps) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-card border bg-bg-elevated p-4 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus ${isSelected ? "border-accent" : "border-line"}`}
    >
      <StyleSample style={style} playCount={playCount} />
      <div className="flex items-start gap-2">
        {/* The replay button stays outside the label so the label names only its radio. */}
        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
          <input type="radio" name="house-style" value={style.id} checked={isSelected} onChange={onSelect} className="mt-1 size-5 shrink-0 accent-accent" />
          <span className="flex min-w-0 flex-col gap-1 text-ui-lg font-semibold text-copy">
            {style.name}
            <span className="text-ui font-normal text-copy-muted">{style.description}</span>
          </span>
        </label>
        <button type="button" aria-label={`Play the ${style.name} sample`} className={buttonClass("quiet", "shrink-0 px-3")} onClick={onPlay}>
          <Play aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  );
}
