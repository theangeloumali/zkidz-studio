// Created by The Angelo Umali.
"use strict";

/* Screen 3: one simulated agent turn. The feed, the terminal and the timeline all update from this one run. */

function setRunningUi(isRunning) {
  $("#stop-btn").hidden = !isRunning;
  $("#send-btn").disabled = isRunning;
  $("#prompt").disabled = isRunning;
  renderVersions();
}

function cutPlanDiff(cutRetake) {
  const rows = [
    ["del", "0:00.0–0:02.4 silence before the first word"],
    ["del", "0:31.8–0:33.1 pause, 1.3 s"],
    cutRetake ? ["del", "1:04.2–1:22.8 retake “okay, one more time”"] : ["ctx", "1:04.2–1:22.8 retake kept"],
    ["ctx", "35 more pauses, each snapped to the quietest frame"],
    ["add", "1.08× punch-in on every other jump cut (19)"],
    ["add", "blur 0:52–0:56 · email address on screen"],
  ];
  return h(
    "ul",
    { class: "diff" },
    rows.map(([kind, text]) => h("li", { class: kind }, text)),
  );
}

const RENDER_MINUTES = {
  cpu: "about 40 min on the CPU",
  apple: "about 9 min",
  nvidia: "about 6 min on the GPU",
};

async function runAgent(prompt) {
  const controller = new AbortController();
  const signal = controller.signal;
  app.running = { controller, openCards: new Set() };
  app.usageTurn = 0;
  const started = performance.now();
  let toolCalls = 0;
  setRunningUi(true);
  setAgentStatus("running", "Starting");
  userRow(prompt);

  try {
    const credentialName = {
      api: "API key",
      cloud: app.provider,
      cli: "Claude Code in a terminal",
    }[app.credential];
    systemRow(`session started · ${credentialName} · 6 skills · 22 studio tools`);
    await wait(500, signal);
    await narrate("Two clips, about three minutes in total. I'll check them, transcribe, then plan the cuts.", signal);

    let tool = toolCard({
      label: "Checking 2 clips",
      name: "probe_media",
      args: "clip-a.mp4, clip-b.mp4",
      readOnly: true,
    });
    toolCalls += 2;
    await wait(900, signal);
    tool.finish("clip-a.mp4 · 1:47 · 4K HEVC · 29.97 fps · clip-b.mp4 · 1:25 · same format");
    addUsage(0.03);

    tool = toolCard({
      label: "Joining clips",
      name: "ingest",
      args: "mode: join",
    });
    toolCalls += 1;
    await runProgress(tool, 1800, signal, (fraction) => `frame ${Math.round(fraction * 5758).toLocaleString("en")} of 5,758`);
    tool.finish("Source ready · 5,758 frames · 1080 proxy for preview");

    if (app.agentState === "rate-limited") await retryBanner(6, signal);

    tool = toolCard({
      label: "Transcribing",
      name: "transcribe",
      args: "language: auto",
    });
    toolCalls += 1;
    await runProgress(tool, 3600, signal, (fraction) =>
      fraction < 0.5 ? "whisper large-v3-turbo · GPU" : `clip ${fraction < 0.75 ? "A" : "B"} · ${Math.round(fraction * 612)} words`,
    );
    tool.finish("612 words · Tagalog and English · 3 swears flagged");
    addUsage(0.06);

    await narrate("Lots of dead air. Here's a cut plan: trim the pauses and the false start at 1:04.", signal);
    tool = toolCard({
      label: "Finding pauses and retakes",
      name: "propose_cuts",
      args: "min_pause: 0.4",
      readOnly: true,
    });
    toolCalls += 1;
    await wait(1100, signal);
    drawVideoLane(false, true);
    tool.finish("Found 38 pauses (41.2 s) and 1 retake (18.6 s). Proposed cuts are struck through on the timeline.");
    addUsage(0.05);

    const cutRetake = await askCard(
      {
        question: "Cut the retake at 1:04 (“okay, one more time”)?",
        options: [
          { label: "Cut it", value: true },
          { label: "Keep it", value: false },
        ],
      },
      signal,
    );
    setAgentStatus("running", "Applying cuts");

    tool = toolCard({
      label: "Applying the cut plan",
      name: "set_cuts",
      args: `39 shots, retake: ${cutRetake ? "cut" : "kept"}`,
    });
    toolCalls += 1;
    await wait(900, signal);
    tool.append(cutPlanDiff(cutRetake));
    app.cutsApplied = true;
    app.time = 0;
    drawRuler();
    drawVideoLane(true);
    updateTimelineMeta();
    updatePlayback();
    addVersion("Cuts");
    tool.finish("3:12 → 1:58 · 39 shots · audio crossfaded at every join · 1 blur");
    addUsage(0.07);

    tool = toolCard({
      label: "Writing captions",
      name: "set_captions",
      args: `${CAPTIONS.length} lines, bottom: 1750`,
    });
    toolCalls += 1;
    await runProgress(tool, 1600, signal, (fraction) => `line ${Math.round(fraction * CAPTIONS.length)} of ${CAPTIONS.length}`);
    app.captionsApplied = true;
    drawCaptionLane(true);
    updatePlayback();
    addVersion("Captions");
    tool.finish(`${CAPTIONS.length} lines · 9 translated from Tagalog · 2 swears masked · none cross a Reels edge`);
    addUsage(0.06);

    tool = toolCard({
      label: "Adding overlays",
      name: "add_cue",
      args: CUES.map((cue) => cue.kind).join(", "),
    });
    toolCalls += CUES.length;
    const tags = h(
      "ul",
      { class: "tag-row" },
      CUES.map((cue) => h("li", {}, cue.kind)),
    );
    tool.append(tags);
    for (const [index, cue] of CUES.entries()) {
      await wait(380, signal);
      app.cuesApplied.push(cue);
      addCueBlock(cue, true);
      tags.children[index].dataset.on = "true";
      updatePlayback();
    }
    addVersion("Overlays");
    tool.finish("6 overlays and their sound effects · every one inside the safe zones");
    addUsage(0.05);

    tool = toolCard({
      label: "Rendering preview stills",
      name: "render_preview",
      args: "at: 0:01, 0:16, 1:32",
      readOnly: true,
    });
    toolCalls += 1;
    await wait(1200, signal);
    tool.append(
      h(
        "div",
        { class: "stills", role: "img", "aria-label": "Three preview stills" },
        h("span", { class: "still" }),
        h("span", { class: "still" }),
        h("span", { class: "still" }),
      ),
    );
    tool.finish("Preview ready · checked at 0:01, 0:16 and 1:32 · no overlaps");
    addUsage(0.03);

    await narrate("Preview is ready. Press play to watch it, or approve the 4K render when you're happy.", signal);
    const approve = await askCard(
      {
        question: "Approve the render?",
        facts: [
          "2 masters: full edit 1:58 · Reels cut 0:59",
          `4K HEVC · ${GPU_PROFILES[app.gpu].encoder} · ${RENDER_MINUTES[app.gpu]}`,
          `writes to ${DELIVERABLES_PATH}`,
        ],
        claudeSays: "Preview is checked at three points and nothing overlaps. Ready for the 4K master and the Reels cut.",
        options: [
          { label: "Approve render", value: true },
          { label: "Not yet", value: false },
        ],
      },
      signal,
    );

    const costText = app.credential === "cli" ? "counted against your plan" : `≈ $${app.usageTurn.toFixed(2)} this turn (estimate)`;
    const elapsedSeconds = ((performance.now() - started) / 1000).toFixed(0);
    feedPush(h("p", { class: "turn-foot" }, h("span", {}, costText), h("span", {}, `${toolCalls} tool calls`), h("span", {}, `${elapsedSeconds} s`)));
    editorTerminal.line(`done · ${toolCalls} tool calls · ${elapsedSeconds} s · ${costText}`, "dim");
    setAgentStatus("done", "Done");
    finishRun();
    if (approve) {
      app.render = null;
      location.hash = "#render";
    } else {
      systemRow("render not started · ask any time");
    }
  } catch (error) {
    if (!(error instanceof Stopped)) throw error;
  }
}

function finishRun() {
  app.running = null;
  setRunningUi(false);
  setIconLabel($("#send-btn"), "arrow-up", "Send");
}
