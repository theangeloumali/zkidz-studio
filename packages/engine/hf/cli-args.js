// Created by The Angelo Umali.
// A missing flag fails rather than taking the next argument: render.js --out's preroll/ and split/ are emptied.
function optionValue(args, name) {
  const value = args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

module.exports = { optionValue };
