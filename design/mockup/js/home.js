// Created by The Angelo Umali.
"use strict";

/* Screen 2: drop zone with per-file progress, the in-place single-file picker, recent projects, templates. Nothing leaves the page. */

const DEFAULT_CLIPS = [
  { name: "clip-a.mp4", meta: "1:47 · 3840×2160 · HEVC", thumb: "thumb-a" },
  { name: "clip-b.mp4", meta: "1:25 · 3840×2160 · HEVC", thumb: "thumb-c" },
];
const THUMBS = ["thumb-a", "thumb-b", "thumb-c"];
const UPLOAD_STEP_MS = 60;

/* A template is a starter prompt plus an ingest mode (plan §9.1, settled item 3). */
const TEMPLATE_PROMPTS = {
  "Talking-head short":
    "Cut this into a 60-second TikTok. Trim the pauses and the retake, translate the Tagalog to English captions, mask the swears, and add a hook title.",
  Vlog: "Make a 45-second vlog from these clips in order. Keep moments where I talk, add light SFX on the cuts, captions in English.",
  "Screen-recording showcase": "Put the screen recording in a panel over my face cam, synced to when I mention it. Captions at the bottom, hook title up top.",
};

function clipsFromFiles(files, metaOf) {
  return files.map((file, index) => ({
    name: file.name,
    meta: metaOf(file),
    thumb: THUMBS[index % THUMBS.length],
  }));
}

function openProject(clips, message, template) {
  resetEditor(clips);
  if (template) $("#prompt").value = TEMPLATE_PROMPTS[template];
  location.hash = "#editor";
  toast(message);
}

/* Per-file progress, as the server streams each upload to media/raw/<assetId>.<ext>.part (plan §9.4). */
async function addDroppedFiles(files) {
  const list = $("#uploads");
  const rows = files.map((file) => {
    const fill = h("span", { class: "progress-fill" });
    const percentNode = h("span", { class: "upload-pct mono" }, "0%");
    const progress = h(
      "div",
      {
        class: "progress",
        role: "progressbar",
        "aria-label": `Adding ${file.name}`,
        "aria-valuemin": 0,
        "aria-valuemax": 100,
        "aria-valuenow": 0,
      },
      fill,
    );
    list.append(h("li", { class: "upload" }, icon("video"), h("span", { class: "upload-name" }, file.name), progress, percentNode));
    return { fill, progress, percentNode };
  });
  list.hidden = false;
  for (let percent = 5; percent <= 100; percent += 5) {
    rows.forEach((row, index) => {
      const filePercent = Math.min(100, Math.max(0, percent * 1.4 - index * 20));
      row.fill.style.setProperty("--v", filePercent / 100);
      row.progress.setAttribute("aria-valuenow", String(Math.round(filePercent)));
      row.percentNode.textContent = `${Math.round(filePercent)}%`;
    });
    await wait(UPLOAD_STEP_MS);
  }
  rows.forEach((row) => row.progress.setAttribute("data-state", "done"));
  await wait(300);
  list.hidden = true;
  list.replaceChildren();
  const clips = clipsFromFiles(files, (file) => `${(file.size / 1048576).toFixed(1)} MB · ${file.type || "video"}`);
  openProject(clips, `${files.length} file${files.length > 1 ? "s" : ""} added to the project.`);
}

wireDropTarget($("#dropzone"), addDroppedFiles);
$("#file-input").addEventListener("change", (event) => addDroppedFiles(Array.from(event.target.files)));
$$("[data-template]").forEach((button) =>
  button.addEventListener("click", () => openProject(DEFAULT_CLIPS, `${button.dataset.template} template ready.`, button.dataset.template)),
);

/* In place: one file is registered where it lives; nothing is copied. Native <dialog> traps focus and closes on Escape. */
const inplaceDialog = $("#inplace-dialog");
$("#inplace-open").addEventListener("click", () => inplaceDialog.showModal());
inplaceDialog.addEventListener("close", () => {
  if (inplaceDialog.returnValue !== "use") return;
  const chosen = $('input[name="inplace"]:checked', inplaceDialog);
  openProject(
    [
      {
        name: chosen.value,
        meta: `${chosen.dataset.meta} · in place`,
        thumb: "thumb-b",
      },
    ],
    `${chosen.value} is used where it is. Nothing was copied.`,
  );
});

function setHomeState(state) {
  const list = $("#project-list");
  list.hidden = state === "empty";
  list.setAttribute("aria-busy", String(state === "loading"));
  $("#project-empty").hidden = state !== "empty";
}

wireSegment("home", setHomeState);
