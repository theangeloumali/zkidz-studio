// Created by The Angelo Umali.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Node-environment tests (the real-server CSRF suite) have no DOM to patch.
const hasDom = typeof window !== "undefined";

// jsdom has no modal dialog support; open/close is all the picker tests need.
if (hasDom && typeof HTMLDialogElement.prototype.showModal !== "function") {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}

// jsdom has no canvas; axe probes it for icon contrast and logs noise otherwise.
if (hasDom) HTMLCanvasElement.prototype.getContext = () => null;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
