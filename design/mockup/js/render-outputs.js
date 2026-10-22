// Created by The Angelo Umali.
"use strict";

/* Screen 4, right column: QC checks, deliverables with SHA-256, hardware meters. */

const DELIVERABLES = [
  {
    name: "Full edit · 4K master",
    meta: "2160×3840 · HEVC · 1:58",
    icon: "film",
    job: "full",
    sha256: "9f2c7a1e04b3d58c6e21f0a9b7d34c58e1a2f6b90c3d7e45a8b1c2d3e4f5a601",
  },
  {
    name: "Reels cut · 4K master",
    meta: "2160×3840 · HEVC · 0:59",
    icon: "film",
    job: "reel",
    sha256: "41ab09e3c7d2f15a8b6e40c9d2a73f1e5b8c06d4a9e2f7b3c1d5e8a0f6b2c74d",
  },
  {
    name: "cover-A.png",
    meta: "intro frame at 0:02.3",
    icon: "image",
    job: "covers",
    sha256: "c03e5f19a2b74d68e0f1a3c5b7d9e2f4a6c8b0d1e3f5a7c9b2d4e6f8a0c1e3f5",
  },
  {
    name: "cover-B.png",
    meta: "same format, free pick",
    icon: "image",
    job: "covers",
    sha256: "7d61e2a4c8f03b5d9e1a7c3f5b0d2e4a6c8e0f2a4b6d8c0e2f4a6b8d0c2e4f6a",
  },
  {
    name: "reels-cover-A.png",
    meta: "Reels intro frame",
    icon: "image",
    job: "covers",
    sha256: "2b8f4d6a0c3e5f7a9b1d3e5f7a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a6c",
  },
  {
    name: "reels-cover-B.png",
    meta: "Reels free pick",
    icon: "image",
    job: "covers",
    sha256: "e5a3c1f9d7b5e3a1c9f7d5b3e1a9c7f5d3b1e9a7c5f3d1b9e7a5c3f1d9b7e5a3",
  },
  {
    name: "caption.txt",
    meta: "post caption and hashtags",
    icon: "file-text",
    job: "covers",
    sha256: "0a4e8c2f6b1d5a9e3c7f0b4d8a2e6c1f5b9d3a7e0c4f8b2d6a1e5c9f3b7d0a4e",
  },
];

/* QC ticks: each passes once the jobs it inspects are done. */
const QC_CHECKS = [
  { name: "Frame count matches the edit", jobs: ["full", "reel"] },
  {
    name: "Footage moves in every shot (motion check against the source)",
    jobs: ["full", "reel"],
  },
  { name: "Audio at −14 LUFS, aligned to picture", jobs: ["full", "reel"] },
  {
    name: "Captions and overlays inside the safe zones",
    jobs: ["full", "reel", "covers"],
  },
  { name: "Privacy blur applied to every cover", jobs: ["covers"] },
  {
    name: "Every copy matches the render (SHA-256)",
    jobs: ["full", "reel", "covers"],
  },
];

function jobDone(jobId) {
  return app.render?.jobs.find((job) => job.id === jobId)?.state === "done";
}

function renderChecks() {
  const targets = app.render.jobs.map((job) => job.id);
  $("#qc-list").replaceChildren(
    ...QC_CHECKS.filter((check) => check.jobs.some((jobId) => targets.includes(jobId))).map((check) => {
      const hasPassed = check.jobs.filter((jobId) => targets.includes(jobId)).every(jobDone);
      return h(
        "li",
        { class: "qc-row", dataset: { state: hasPassed ? "ok" : "wait" } },
        icon(hasPassed ? "check" : "clock"),
        h("span", {}, check.name),
        h("span", { class: "sr-only" }, hasPassed ? " passed" : " waiting"),
      );
    }),
  );
}

function renderDeliverables() {
  const targets = app.render.jobs.map((job) => job.id);
  $("#deliverables").replaceChildren(
    ...DELIVERABLES.filter((deliverable) => targets.includes(deliverable.job)).map((deliverable) => {
      const isReady = jobDone(deliverable.job);
      const shortHash = `sha256 ${deliverable.sha256.slice(0, 8)}…${deliverable.sha256.slice(-4)}`;
      const button = h(
        "button",
        {
          type: "button",
          class: "icon-btn icon-btn-sm",
          "aria-label": `Download ${deliverable.name}`,
        },
        icon("download"),
      );
      button.disabled = !isReady;
      button.addEventListener("click", () => toast(`Mock-up: this saves ${deliverable.name} from deliverables/.`));
      return h(
        "li",
        { class: "deliv", dataset: { ready: String(isReady) } },
        icon(deliverable.icon),
        h(
          "span",
          { class: "deliv-main" },
          h("span", { class: "deliv-name" }, deliverable.name),
          h("span", { class: "deliv-meta mono" }, isReady ? deliverable.meta : "waiting for render"),
          isReady ? h("span", { class: "deliv-hash mono", title: deliverable.sha256 }, shortHash) : null,
        ),
        button,
      );
    }),
  );
}

const UTIL_ROWS = {
  nvidia: [
    ["GPU", 87, 8],
    ["NVENC", 64, 10],
    ["CPU", 22, 8],
  ],
  apple: [
    ["Media engine", 78, 10],
    ["CPU composite", 64, 12],
    ["Memory", 36, 0],
  ],
  cpu: [
    ["CPU", 96, 4],
    ["Memory", 41, 0],
    ["GPU", null, 0],
  ],
};

function renderUtil() {
  const isRendering = app.render?.jobs.some((job) => job.state === "run");
  $("#util").replaceChildren(
    ...UTIL_ROWS[app.gpu].map(([name, base, spread]) => {
      const percent = base === null ? null : isRendering ? Math.min(99, base + Math.round((Math.random() - 0.5) * spread)) : 2;
      return h(
        "div",
        {},
        h("dt", {}, name),
        h(
          "div",
          {
            class: "meter",
            role: "meter",
            "aria-label": `${name} utilization`,
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            "aria-valuenow": percent ?? 0,
          },
          h("span", {
            class: "meter-fill",
            style: { "--v": String((percent ?? 0) / 100) },
          }),
        ),
        h("dd", {}, percent === null ? "not used" : `${percent}%`),
      );
    }),
  );
}
