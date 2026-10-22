// Created by The Angelo Umali.
// The ZKidz Z mark, traced from the brand logo (1120x1410 px) as three marker strokes and two nodes.
const Z_LOGO = {
  width: 1120,
  height: 1410,
  bar: 96,
  tealPath: [
    [316, 149],
    [1052, 149],
    [405, 1090],
  ],
  goldPath: [
    [714, 317],
    [62, 1258],
    [800, 1258],
  ],
  tealNode: [212, 144],
  goldNode: [907, 1264],
  nodeRadius: 104,
  nodeWidth: 80,
};

function zLogoPoint(originX, originY, scale, [logoX, logoY]) {
  return [originX + logoX * scale, originY + logoY * scale];
}

// options: teal / gold draw-on progress, tealNode / goldNode pop scale, glowTeal / glowGold 0..1.
function drawZLogo(originX, originY, scale, options = {}) {
  const toScreen = (points) => points.map((point) => zLogoPoint(originX, originY, scale, point));
  const stroke = (points, color, progress) =>
    sketchPath(slicePath(toScreen(points), progress), {
      color,
      width: Z_LOGO.bar * scale,
      rough: 1.2,
      passes: 1,
      cap: "butt",
      sharp: true,
    });
  const node = (center, color, pop, glow) => {
    if (pop <= 0) return;
    const [screenX, screenY] = zLogoPoint(originX, originY, scale, center);
    if (glow > 0) {
      sketchEllipse(screenX, screenY, Z_LOGO.nodeRadius * scale * (1.3 + glow * 0.6), Z_LOGO.nodeRadius * scale * (1.3 + glow * 0.6), {
        color,
        width: 3,
        alpha: 1 - glow,
      });
    }
    const radius = Z_LOGO.nodeRadius * scale * pop;
    sketchEllipse(screenX, screenY, radius, radius, { color, width: Z_LOGO.nodeWidth * scale * pop, passes: 1, rough: 1 });
  };
  if (options.teal > 0) stroke(Z_LOGO.tealPath, C.teal, options.teal);
  if (options.gold > 0) stroke(Z_LOGO.goldPath, C.gold, options.gold);
  node(Z_LOGO.tealNode, C.teal, options.tealNode ?? 0, options.glowTeal ?? 0);
  node(Z_LOGO.goldNode, C.gold, options.goldNode ?? 0, options.glowGold ?? 0);
}
