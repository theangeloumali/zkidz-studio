// Created by The Angelo Umali.
// The map's geography: named regions, an equirectangular projection (cos(lat) at the box centre) fitted to a box, and the
// land as one SVG path for what the view shows. Antimeridian-crossing views are out of scope: every place is 100-150E.
const { num } = require("../../../brand/recorder");
const { DETAIL, WORLD } = require("./land");

const REGIONS = { japan: [124, 24, 147, 46], asia: [60, -12, 150, 55], world: [-180, -58, 180, 80] };
const DETAIL_CLIP = [60, -50, 180, 84];
const VIEW_SLACK = 0.18; // draw land this far (share of the box) beyond it, so a follow pan never shows an edge

function regionOf(region) {
  const bounds = typeof region === "string" ? REGIONS[region] : region;
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite))
    throw new Error(`routeMap: region is ${Object.keys(REGIONS).join(", ")} or [lonW, latS, lonE, latN], not ${JSON.stringify(region)}`);
  const [west, south, east, north] = bounds;
  if (west >= east) throw new Error(`routeMap: region ${JSON.stringify(bounds)} crosses the antimeridian, which is not supported`);
  if (south >= north) throw new Error(`routeMap: region ${JSON.stringify(bounds)} has its south at or above its north`);
  return bounds;
}

// lon/lat → page px: the region fitted inside `box` ([x, y, w, h]) and centred, one scale both ways.
function projection(box, region) {
  const [west, south, east, north] = regionOf(region);
  const [x, y, w, h] = box;
  const [lonC, latC] = [(west + east) / 2, (south + north) / 2];
  const cos = Math.cos((latC * Math.PI) / 180);
  const scale = Math.min(w / ((east - west) * cos), h / (north - south));
  const [cx, cy] = [x + w / 2, y + h / 2];
  const project = (lon, lat) => [cx + (lon - lonC) * cos * scale, cy - (lat - latC) * scale];
  // The lon/lat the box (and its slack) shows, to pick the data and skip land outside.
  const reach = (slack) => [
    lonC - ((w / 2) * (1 + slack)) / (cos * scale),
    latC - ((h / 2) * (1 + slack)) / scale,
    lonC + ((w / 2) * (1 + slack)) / (cos * scale),
    latC + ((h / 2) * (1 + slack)) / scale,
  ];
  return Object.assign(project, { region: [west, south, east, north], scale, centre: [cx, cy], reach });
}

let decoded = null;
function decode() {
  decoded ??= [DETAIL, WORLD].map((rings) =>
    rings.map((ring) => {
      const points = [[ring[0] / 100, ring[1] / 100]];
      for (let index = 2; index < ring.length; index += 2) {
        const last = points.at(-1);
        points.push([last[0] + ring[index] / 100, last[1] + ring[index + 1] / 100]);
      }
      const [lons, lats] = [points.map((p) => p[0]), points.map((p) => p[1])];
      return { points, bounds: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)] };
    }),
  );
  return decoded;
}

// 1:50m inside its clip, 1:110m for anything wider (world, or a region reaching past lon 60-180 / lat -50-84).
function landPath(project) {
  const [west, south, east, north] = project.region;
  const fits = west >= DETAIL_CLIP[0] && south >= DETAIL_CLIP[1] && east <= DETAIL_CLIP[2] && north <= DETAIL_CLIP[3];
  const [detail, world] = decode();
  const [vw, vs, ve, vn] = project.reach(VIEW_SLACK);
  return (fits ? detail : world)
    .filter(({ bounds: [w, s, e, n] }) => e >= vw && w <= ve && n >= vs && s <= vn)
    .map(
      ({ points }) =>
        `M${points
          .map(([lon, lat]) =>
            project(lon, lat)
              .map((value) => num(Math.round(value * 10) / 10))
              .join(" "),
          )
          .join("L")}Z`,
    )
    .join("");
}

module.exports = { projection, landPath };
