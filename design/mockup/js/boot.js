// Created by The Angelo Umali.
"use strict";

/* Runs last: every screen script has registered its handlers. */
applyGpu("nvidia");
resetEditor();
updateCredentialChip();
updateConnectGate();
showScreen(location.hash.slice(1) || "connect");
