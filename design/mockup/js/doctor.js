// Created by The Angelo Umali.
"use strict";

/* Setup step 1, right column: the machine check. The encoder is proven by a test encode, not by driver names. */

const GPU_PROFILES = {
  nvidia: {
    detail: "NVIDIA RTX · NVENC HEVC · 4K test encode passed",
    help: "Tested by encoding real frames, not by reading driver names.",
    state: "ok",
    encoder: "hevc_nvenc",
    chips: [
      ["hevc_nvenc", true],
      ["libplacebo", true],
      ["opencl", true],
      ["whisper", false],
    ],
    profile: "Profile: NVIDIA · hevc_nvenc · 4 chunks",
    device: "NVIDIA RTX",
  },
  apple: {
    detail: "Apple VideoToolbox · HEVC · overlays composited on the CPU",
    help: "Speech runs on whisper.cpp with Metal.",
    state: "ok",
    encoder: "hevc_videotoolbox",
    chips: [
      ["hevc_videotoolbox", true],
      ["libplacebo", false],
      ["opencl", false],
      ["whisper", false],
    ],
    profile: "Profile: Apple · hevc_videotoolbox · 2 chunks",
    device: "Apple silicon",
  },
  cpu: {
    detail: "No hardware encoder · CPU fallback (libx265)",
    help: "Nothing to fix. Everything works; renders take longer, so 1080p masters are suggested.",
    state: "info",
    encoder: "libx265",
    chips: [
      ["libx265", true],
      ["libplacebo", false],
      ["opencl", false],
      ["whisper", false],
    ],
    profile: "Profile: CPU · libx265 · 1 job",
    device: "CPU only",
  },
};

function applyGpu(gpu) {
  app.gpu = gpu;
  const profile = GPU_PROFILES[gpu];
  $("#gpu-detail").textContent = profile.detail;
  $("#gpu-help").textContent = profile.help;
  $("#doctor-gpu").dataset.state = profile.state;
  $(".feature-chips").replaceChildren(
    ...profile.chips.map(([name, isOn]) => h("li", { dataset: { on: String(isOn) } }, name, isOn ? null : h("span", { class: "sr-only" }, " not available"))),
  );
  setRadioGroup($$("[data-gpu]"), $(`[data-gpu="${gpu}"]`));
  $("#profile-line").textContent = profile.profile;
  $("#util-device").textContent = profile.device;
  $("#first-encoder").textContent = profile.encoder;
  $("#cpu-notice").hidden = gpu !== "cpu";
  if (!app.renderError) setRadioGroup($$("[data-render]"), $(gpu === "cpu" ? '[data-render="cpu"]' : '[data-render="gpu"]'));
  if (app.render) renderQueue();
  renderUtil();
}

$$("[data-gpu]").forEach((button) => button.addEventListener("click", () => applyGpu(button.dataset.gpu)));

$("#whisper-download").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const bar = $("#whisper-progress");
  button.disabled = true;
  bar.hidden = false;
  for (let percent = 0; percent <= 100; percent += 5) {
    bar.firstElementChild.style.setProperty("--v", percent / 100);
    $("#whisper-detail").textContent = `whisper large-v3-turbo · ${((1.6 * percent) / 100).toFixed(2)} of 1.6 GB`;
    await wait(110);
  }
  bar.dataset.state = "done";
  $("#doctor-whisper").dataset.state = "ok";
  $("#doctor-whisper .doctor-icon").replaceWith(icon("check", "doctor-icon"));
  $("#whisper-detail").textContent = "whisper large-v3-turbo · 1.6 GB · SHA-256 verified";
  $("#whisper-fix").remove();
  button.remove();
});

$("#doctor-rerun").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  setIconLabel(button, "loader", "Checking", "spin");
  await wait(900);
  button.disabled = false;
  setIconLabel(button, "refresh", "Run checks again");
  toast("All checks finished.");
});
