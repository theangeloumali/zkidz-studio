// Created by The Angelo Umali.
"use strict";

/* Version strip: every agent write saves a version. Restore is non-destructive: it saves a new version on top. */

const editVersions = [];
let selectedVersionNumber = null;

function snapshotEdit() {
  return {
    cutsApplied: app.cutsApplied,
    captionsApplied: app.captionsApplied,
    cuesApplied: [...app.cuesApplied],
  };
}

function addVersion(label) {
  editVersions.push({
    number: editVersions.length + 1,
    label,
    snapshot: snapshotEdit(),
  });
  selectedVersionNumber = null;
  renderVersions();
}

function resetVersions() {
  editVersions.length = 0;
  addVersion("Uncut");
}

function renderVersions() {
  const latestNumber = editVersions.length;
  $("#version-list").replaceChildren(
    ...editVersions.map((version) => {
      const isCurrent = version.number === latestNumber;
      const button = h(
        "button",
        {
          type: "button",
          class: "version",
          "aria-pressed": String(version.number === selectedVersionNumber),
          "aria-current": isCurrent ? "true" : null,
        },
        h("span", { class: "mono" }, `v${version.number}`),
        version.label,
      );
      button.addEventListener("click", () => {
        selectedVersionNumber = isCurrent || version.number === selectedVersionNumber ? null : version.number;
        renderVersions();
      });
      return h("li", {}, button);
    }),
  );
  const restoreButton = $("#version-restore");
  restoreButton.hidden = selectedVersionNumber === null;
  restoreButton.disabled = Boolean(app.running);
  if (selectedVersionNumber !== null) restoreButton.textContent = `Restore v${selectedVersionNumber}`;
}

$("#version-restore").addEventListener("click", () => {
  const version = editVersions[selectedVersionNumber - 1];
  if (!version || app.running) return;
  Object.assign(app, {
    ...version.snapshot,
    cuesApplied: [...version.snapshot.cuesApplied],
    time: 0,
  });
  drawTimeline();
  addVersion(`Restored v${version.number}`);
  toast(`Restored v${version.number}. Everything after it is still in the strip.`);
});
