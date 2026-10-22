// Created by The Angelo Umali.
"use strict";

/* Shared state, helpers, routing and theme. Classic scripts (not modules) so the page runs from file://. */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const SVG_NS = "http://www.w3.org/2000/svg";

const RAW_SECONDS = 192;
const EDIT_SECONDS = 118;
const PROJECT_SLUG = "i-let-ai-edit-my-videos";
const DELIVERABLES_PATH = `ZKS_HOME/projects/${PROJECT_SLUG}/deliverables/`;
const SCREEN_TITLES = {
  connect: "Connect Claude",
  "first-render": "First render",
  style: "Pick a style",
  home: "Home",
  editor: "Editor",
  rules: "Rules",
  render: "Render & export",
};
const SCREENS = Object.keys(SCREEN_TITLES);
/* Setup steps highlight the Connect tab; Rules belongs to the editor's project. */
const NAV_PARENT = {
  "first-render": "connect",
  style: "connect",
  rules: "editor",
};

const app = {
  credential: "api",
  provider: "Bedrock",
  apiKeyTail: "ab12",
  keyCheckAccepts: true,
  agentState: "normal",
  gpu: "nvidia",
  renderError: false,
  running: null,
  cutsApplied: false,
  captionsApplied: false,
  cuesApplied: [],
  playing: false,
  time: 0,
  usageTurn: 0,
  usageProject: 2.56,
  render: null,
};

function icon(name, extraClass = "") {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", `icon ${extraClass}`.trim());
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

/* The only DOM builder: strings become text nodes, never markup, so agent text renders literally (plan §9.1, §11). */
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (value === undefined || value === null || value === false) return;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "style") Object.entries(value).forEach(([property, styleValue]) => node.style.setProperty(property, styleValue));
    else node.setAttribute(key, value === true ? "" : String(value));
  });
  node.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

function setIconLabel(button, iconName, label, iconClass = "") {
  button.replaceChildren(icon(iconName, iconClass), label);
}

function formatTime(seconds) {
  const whole = Math.max(0, seconds);
  const minutes = Math.floor(whole / 60);
  const rest = (whole - minutes * 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${rest}`;
}

function formatClock(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

class Stopped extends Error {}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Stopped());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Stopped());
      },
      { once: true },
    );
  });
}

let toastTimer = 0;
function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.dataset.show = "true";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.dataset.show = "false"), 2600);
}

function setRadioGroup(buttons, active) {
  buttons.forEach((button) => button.setAttribute("aria-checked", String(button === active)));
}

/* One wiring for every prototype segmented control: [data-<key>] buttons call onPick(value). */
function wireSegment(key, onPick) {
  const buttons = $$(`[data-${key}]`);
  buttons.forEach((button) =>
    button.addEventListener("click", () => {
      setRadioGroup(buttons, button);
      onPick(button.dataset[key]);
    }),
  );
}

/* Deterministic pseudo-random, so every reload draws the same edit. */
function seeded(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function wireDropTarget(target, onFiles) {
  ["dragenter", "dragover"].forEach((type) =>
    target.addEventListener(type, (event) => {
      event.preventDefault();
      target.dataset.over = "true";
    }),
  );
  ["dragleave", "drop"].forEach((type) =>
    target.addEventListener(type, (event) => {
      event.preventDefault();
      target.dataset.over = "false";
    }),
  );
  target.addEventListener("drop", (event) => {
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length) onFiles(files);
  });
}

function showScreen(name) {
  const screen = SCREENS.includes(name) ? name : "connect";
  const navTarget = NAV_PARENT[screen] || screen;
  $$(".screen").forEach((section) => (section.hidden = section.dataset.screen !== screen));
  $$("[data-nav]").forEach((link) => {
    if (link.dataset.nav === navTarget) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.title = `${SCREEN_TITLES[screen]} · ZKidz Studio mock-up`;
  if (screen === "editor") requestAnimationFrame(sizeCanvas);
  if (screen === "render" && !app.render) startRender();
  if (screen === "first-render") playSample($("#first-render-player"));
}

window.addEventListener("hashchange", () => showScreen(location.hash.slice(1)));

$("#theme-toggle").addEventListener("click", (event) => {
  const root = document.documentElement;
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  event.currentTarget.setAttribute("aria-label", next === "dark" ? "Switch to light theme" : "Switch to dark theme");
  event.currentTarget.replaceChildren(icon(next === "dark" ? "sun" : "moon"));
  drawFootage();
});
