// Created by The Angelo Umali.
// HyperFrames sound design over the canvas sounds: a card's swish becomes a fly-in that lands with it, its swishOut a
// whip timed to the longer exit, the stamp's thud a deeper boom. Word-timed sounds (checks, ticks, rules) keep their
// canvas times, so every beat still lands on its word. Recipes are in sfx.py.
const { canvasBrand } = require("../brand/canvas");
const { BOLD_EXIT } = require("./motion");

const SWAPS = { swish: "flyIn", swishOut: "whipOut", thud: "boom" };

function redesign(events, duration) {
  const cardExit = duration - canvasBrand().scope.EXIT;
  return events.map((event) => {
    const sound = SWAPS[event.sound] ?? event.sound;
    // A card's exit moved earlier with its longer motion; a cutaway's swishOut (at its cover) did not.
    const at = event.sound === "swishOut" && Math.abs(event.at - cardExit) < 1e-6 ? duration - BOLD_EXIT : event.at;
    return { ...event, sound, at };
  });
}

module.exports = { redesign };
