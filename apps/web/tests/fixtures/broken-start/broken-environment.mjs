// Created by The Angelo Umali.
// A test environment whose setup always fails, so every worker fails to start.
export default {
  name: "broken-start",
  viteEnvironment: "ssr",
  setup() {
    throw new Error("environment setup failed");
  },
};
