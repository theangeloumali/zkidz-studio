// Created by The Angelo Umali.
// Mirrors the web config's shared forks (isolate false) with more files than workers, so a failed runner gets offered again.
export default { test: { environment: "./broken-environment.mjs", isolate: false, maxWorkers: 2, include: ["*.fixture.mjs"] } };
