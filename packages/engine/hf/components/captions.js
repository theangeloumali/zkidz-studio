// Created by The Angelo Umali.
// English caption plate, drawn by the canvas page's own caption component (ink plate, goldBright edge, at most two lines,
// bottom 1430). Crisp on purpose, as on canvas: no effects. Captions timemap.js joins swap in place without a fade.
const { rise, exit } = require("../fx/motion");
const { k, SETTLED, drawn } = require("./parts");

const caption = {
  track: 3,
  render(cue, { duration, cues }) {
    // The canvas asks activeCues frame by frame; a name plate overlapping any moment of this caption lifts it for its span.
    const owners = cues.filter((other) => k.BAND_OWNERS[other.kind] && other.start < cue.stop && other.stop > cue.start);
    const plate = k.COMPONENTS.caption;
    return {
      html: drawn(cue, "plate", () => plate(cue, { local: SETTLED, duration, exit: 0 }), undefined, { active: owners }),
      motion: cue.joinsBefore ? [] : rise(".plate", 0, { distance: 10, scaleFrom: 1 }),
      // The canvas fades a caption by its envelope's exit, without the lift other cues get.
      exit: cue.joinsAfter ? [] : exit(".plate", duration, { fadeOnly: true }),
    };
  },
};

module.exports = { caption };
