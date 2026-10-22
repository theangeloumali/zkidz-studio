// Created by The Angelo Umali.
// Cover title for TikTok thumbnails. Kept inside the centre 3:4 band, which the profile grid shows.
// Static (covers are single frames), so it has no motion and no SFX.

COMPONENTS.coverTitle = (cue) => {
  const top = cue.y ?? 400;
  const titleFont = { ...TYPE.display, size: cue.size ?? 132 };
  cue.lines.forEach((line, index) => {
    strokedText(line, PW / 2, top + index * titleFont.size * 1.02, titleFont, {
      align: "center",
      fill: cue.accentLine === index ? BRAND.goldBright : BRAND.paper,
      outline: 20,
    });
  });
  if (cue.sub) {
    const subY = top + cue.lines.length * titleFont.size * 1.02 + 20;
    strokedText(cue.sub, PW / 2, subY, { ...TYPE.hand, size: 88 }, { align: "center", fill: BRAND.goldBright, outline: 14, rot: -0.03 });
  }
};

SFX_OF.coverTitle = () => [];
