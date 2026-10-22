// Created by The Angelo Umali.
"use strict";

/* Screen 4: target picker, render queue, hardware use, QC checks and deliverables. Stage names follow the engine's master pipeline. */

const JOB_SPECS = [
  { id: "full", title: "Full edit · 4K master", frames: 3540, seconds: 13 },
  { id: "reel", title: "Reels cut · 4K master", frames: 1770, seconds: 7 },
  { id: "covers", title: "Covers and caption", frames: 0, seconds: 1.5 },
];

const STAGES = [
  { id: "audio", name: "Audio mix", bounds: [0, 0.05] },
  { id: "sfx", name: "Sound effects", bounds: [0.05, 0.08] },
  { id: "overlay", name: "Overlay frames", bounds: [0.08, 0.45] },
  { id: "encode", name: "Encode", bounds: [0.45, 0.95] },
  { id: "checks", name: "Checks", bounds: [0.95, 1] },
];

let renderTimer = 0;

function selectedTargets() {
  return $$('input[name="target"]:checked').map((input) => input.value);
}

function startRender() {
  clearInterval(renderTimer);
  const targets = selectedTargets();
  app.render = {
    jobs: JOB_SPECS.filter((spec) => targets.includes(spec.id)).map((spec) => ({
      ...spec,
      progress: 0,
      state: "queued",
      failed: false,
    })),
    tick: 0,
  };
  $("#flood").hidden = true;
  $("#flood-path").textContent = DELIVERABLES_PATH;
  renderQueue();
  renderDeliverables();
  renderChecks();
  renderTimer = setInterval(tickRender, 200);
}

function tickRender() {
  const render = app.render;
  render.tick += 1;
  const job = render.jobs.find((candidate) => candidate.state === "queued" || candidate.state === "run");
  if (!job) {
    clearInterval(renderTimer);
    const fileCount = DELIVERABLES.filter((deliverable) => render.jobs.some((done) => done.id === deliverable.job)).length;
    $("#flood-count").textContent = `${fileCount} file${fileCount === 1 ? "" : "s"}`;
    $("#flood").hidden = render.jobs.length === 0;
    renderUtil();
    return;
  }
  job.state = "run";
  if (app.renderError && job.id === "full" && !job.failed && job.progress >= 0.7) {
    job.failed = true;
    job.state = "error";
    clearInterval(renderTimer);
    renderQueue();
    renderUtil();
    return;
  }
  job.progress = Math.min(1, job.progress + 0.2 / job.seconds);
  if (job.progress >= 1) job.state = "done";
  renderQueue();
  renderDeliverables();
  renderChecks();
  if (render.tick % 5 === 0) renderUtil();
}

function etaText(job) {
  const factor = { cpu: 9, apple: 1.6, nvidia: 1 }[app.gpu];
  const secondsLeft = (1 - job.progress) * job.seconds * 28 * factor;
  return secondsLeft < 60 ? `${Math.max(1, Math.round(secondsLeft))} s left` : `${Math.round(secondsLeft / 60)} min left`;
}

function jobStatus(job) {
  if (job.state === "done") return h("span", { class: "badge badge-success" }, "Done");
  if (job.state === "error") return h("span", { class: "badge badge-danger" }, "Failed");
  if (job.state === "run") return h("span", { class: "job-eta mono" }, `${Math.round(job.progress * 100)}% · ${etaText(job)}`);
  return h("span", { class: "badge" }, "Queued");
}

function retryNotice() {
  const gpuButton = h("button", { type: "button", class: "btn btn-sm btn-accent" }, "Retry chunk 3");
  const cpuButton = h("button", { type: "button", class: "btn btn-sm" }, "Retry on the CPU");
  gpuButton.addEventListener("click", () => retryFailed("gpu"));
  cpuButton.addEventListener("click", () => retryFailed("cpu"));
  return h(
    "div",
    { class: "notice notice-error" },
    icon("alert"),
    h(
      "div",
      {},
      h(
        "p",
        {},
        h("strong", {}, "Chunk 3 of 4 failed."),
        " The encoder couldn't open another session. The other chunks are saved, so only chunk 3 runs again.",
      ),
      h("div", { class: "job-actions" }, gpuButton, cpuButton),
    ),
  );
}

function renderQueue() {
  const encoderName = (job) => (job.id === "covers" ? "chrome-headless" : GPU_PROFILES[app.gpu].encoder);
  $("#queue").replaceChildren(
    ...app.render.jobs.map((job) =>
      h(
        "li",
        { class: "job" },
        h(
          "div",
          { class: "job-head" },
          icon(job.id === "covers" ? "image" : "film"),
          h("span", { class: "job-title" }, job.title),
          h("span", { class: "chip mono" }, encoderName(job)),
          jobStatus(job),
        ),
        job.state === "run" || job.state === "error" ? stageList(job) : null,
        job.state === "error" ? retryNotice() : null,
      ),
    ),
  );
}

function retryFailed(target) {
  app.renderError = false;
  if (target === "cpu") applyGpu("cpu");
  else setRadioGroup($$("[data-render]"), $('[data-render="gpu"]'));
  app.render.jobs.find((job) => job.state === "error").state = "run";
  renderTimer = setInterval(tickRender, 200);
}

function stageFraction(job, stage) {
  if (job.id === "covers") return job.progress;
  const [start, end] = stage.bounds;
  return Math.min(Math.max((job.progress - start) / (end - start), 0), 1);
}

function bar(fraction, state, label) {
  return h("div", { class: "progress", dataset: { state }, "aria-label": label }, h("span", { class: "progress-fill", style: { "--v": String(fraction) } }));
}

/* Four parallel chunks, like render_final's RENDER_JOBS; each starts a little after the last. */
function chunkBars(fraction, isFailing) {
  return h(
    "div",
    { class: "chunks" },
    [0, 1, 2, 3].map((chunk) => {
      const isBroken = isFailing && chunk === 2;
      const chunkFraction = isBroken ? 0.62 : Math.min(Math.max(fraction * 4 - chunk * 0.35, 0), 1);
      return bar(chunkFraction, isBroken ? "error" : chunkFraction >= 1 ? "done" : "", `Chunk ${chunk + 1}`);
    }),
  );
}

function stageList(job) {
  const stages = job.id === "covers" ? [{ id: "covers", name: "Covers" }] : STAGES;
  return h(
    "ol",
    { class: "stages" },
    stages.map((stage) => {
      const fraction = stageFraction(job, stage);
      const isFailing = job.state === "error" && stage.id === "encode";
      const state = isFailing ? "error" : fraction >= 1 ? "done" : fraction > 0 ? "run" : "wait";
      let label = `${Math.round(fraction * 100)}%`;
      if (stage.id === "overlay") label = `${Math.round(fraction * job.frames)}/${job.frames}`;
      if (stage.id === "checks" && fraction >= 1) label = "passed";
      if (isFailing) label = "chunk 3";
      const detail = stage.id === "encode" ? chunkBars(fraction, isFailing) : bar(fraction, state === "done" ? "done" : "");
      const stageIcon = {
        done: "check",
        error: "x",
        run: "loader",
        wait: "clock",
      }[state];
      return h(
        "li",
        { class: "stage-row", dataset: { state } },
        icon(stageIcon),
        h("span", { class: "stage-name" }, stage.name),
        detail,
        h("span", { class: "stage-pct" }, label),
      );
    }),
  );
}

$("#render-1080").addEventListener("click", () => {
  app.render.jobs.forEach((job) => {
    if (job.id !== "covers") job.title = job.title.replace("4K", "1080p");
  });
  renderQueue();
  toast("Switched to 1080p masters.");
});

$("#open-folder").addEventListener("click", () => toast(`Mock-up: this opens ${DELIVERABLES_PATH} in your file manager.`));
$$('input[name="target"]').forEach((input) => input.addEventListener("change", startRender));

wireSegment("render", (mode) => {
  app.renderError = mode === "error";
  applyGpu(mode === "cpu" ? "cpu" : "nvidia");
  startRender();
});
