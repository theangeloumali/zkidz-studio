// Created by The Angelo Umali.
"use strict";

/* The 5 s sample render: end of setup, and one per style card. Progress is linear because it is a clock. */

const SAMPLE_SECONDS = 5;
const sampleTimers = new WeakMap();

function playSample(figure) {
  clearTimeout(sampleTimers.get(figure));
  figure.dataset.playing = "false";
  void figure.offsetWidth; // restart the CSS animation
  figure.dataset.playing = "true";
  sampleTimers.set(
    figure,
    setTimeout(() => (figure.dataset.playing = "done"), SAMPLE_SECONDS * 1000),
  );
}

$$("[data-replay]").forEach((button) =>
  button.addEventListener("click", (event) => {
    event.preventDefault();
    playSample(button.closest(".sample"));
  }),
);

$$('input[name="style"]').forEach((input) => input.addEventListener("change", () => playSample($(".sample", input.closest(".style-card")))));
