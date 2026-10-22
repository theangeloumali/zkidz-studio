// Created by The Angelo Umali.
"use strict";

/* Setup step 1: Connect Claude. Modes in plan order: A (API key, default), B (cloud provider), C (Claude Code in a terminal, opt-in). */

const continueButton = $("#connect-continue");
const signinTerminal = createTerminal($("#signin-term-body"));
const connectState = {
  keyAccepted: false,
  cloudAccepted: false,
  cliSignedIn: false,
};

function selectedAuth() {
  return $('input[name="auth"]:checked').value;
}

function setStatus(node, tone, iconName, text) {
  node.dataset.tone = tone;
  node.replaceChildren(icon(iconName, iconName === "loader" ? "spin" : ""), text);
}

function updateConnectGate() {
  const mode = selectedAuth();
  $$("[data-auth-detail]").forEach((detail) => (detail.hidden = detail.dataset.authDetail !== mode));
  const [isReady, waitingMessage] = {
    api: [connectState.keyAccepted, "Check your key to continue."],
    cloud: [connectState.cloudAccepted, "Check your cloud profile to continue."],
    cli: [connectState.cliSignedIn && $("#cli-consent").checked, connectState.cliSignedIn ? "Tick the box to continue." : "Sign in inside the terminal first."],
  }[mode];
  continueButton.disabled = !isReady;
  $("#connect-gate").textContent = isReady ? "Ready." : waitingMessage;
}

$$('input[name="auth"]').forEach((input) => input.addEventListener("change", updateConnectGate));
$("#cli-consent").addEventListener("change", updateConnectGate);

$("#api-key").addEventListener("input", () => {
  connectState.keyAccepted = false;
  $("#api-key-status").replaceChildren();
  updateConnectGate();
});

/* Mode A: the only client check is "not empty"; the server's GET /v1/models answer decides (plan §6.5). */
$("#api-key-check").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const pastedKey = $("#api-key").value.trim();
  const status = $("#api-key-status");
  if (!pastedKey) {
    setStatus(status, "bad", "alert", "Paste a key first.");
    $("#api-key").focus();
    return;
  }
  button.disabled = true;
  setStatus(status, "", "loader", "Checking key…");
  await wait(800);
  button.disabled = false;
  connectState.keyAccepted = app.keyCheckAccepts;
  if (app.keyCheckAccepts) {
    app.apiKeyTail = pastedKey.slice(-4);
    setStatus(status, "ok", "check", `Key works · ending in ${app.apiKeyTail}`);
  } else {
    setStatus(status, "bad", "x", "Anthropic rejected this key (401). Copy it again from the Claude Console and paste it here.");
  }
  updateConnectGate();
});

wireSegment("keycheck", (answer) => {
  app.keyCheckAccepts = answer === "200";
  connectState.keyAccepted = false;
  $("#api-key-status").replaceChildren();
  updateConnectGate();
});

/* Mode B: the server reads the provider's own CLI profile; no cloud secret ever reaches the studio. */
const PROVIDER_PROFILES = {
  Bedrock: "AWS profile default · us-west-2 · Claude models enabled",
  "Vertex AI": "gcloud project zkidz-video · us-east5 · Claude models enabled",
  Foundry: "Azure subscription found · Foundry resource zkidz · Claude deployed",
  "Claude Platform on AWS": "AWS profile default · Claude Platform workspace found",
};

$("#cloud-provider").addEventListener("change", () => {
  connectState.cloudAccepted = false;
  $("#cloud-status").replaceChildren();
  updateConnectGate();
});

$("#cloud-check").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const provider = $("#cloud-provider").value;
  button.disabled = true;
  setStatus($("#cloud-status"), "", "loader", `Checking your ${provider} profile…`);
  await wait(800);
  button.disabled = false;
  app.provider = provider;
  connectState.cloudAccepted = true;
  setStatus($("#cloud-status"), "ok", "check", PROVIDER_PROFILES[provider]);
  updateConnectGate();
});

/* Mode C: the user signs in inside their own terminal with Claude Code's /login; the studio only reads the outcome. */
async function runTerminalSignIn(terminal) {
  terminal.line("$ claude", "cmd");
  await wait(500);
  terminal.line("Not signed in. Type /login to sign in.", "warn");
  await wait(700);
  terminal.line("> /login", "cmd");
  await wait(500);
  terminal.line("Opening your browser to finish signing in…", "out");
  await wait(1400);
  terminal.line("Signed in.", "ok");
}

$("#cli-open").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  $("#signin-term").hidden = false;
  signinTerminal.clear();
  setStatus($("#cli-status"), "", "loader", "Waiting for you to sign in in the terminal…");
  await runTerminalSignIn(signinTerminal);
  connectState.cliSignedIn = true;
  setStatus($("#cli-status"), "ok", "check", "Signed in (shown by Claude Code)");
  button.disabled = false;
  updateConnectGate();
});

continueButton.addEventListener("click", () => {
  app.credential = selectedAuth();
  updateCredentialChip();
  updateUsage();
  location.hash = "#first-render";
});

function updateCredentialChip() {
  const failureText = {
    "key-rejected": "Claude · key rejected",
    "signed-out": "Claude · terminal signed out",
  }[app.agentState];
  $("#credential-chip .dot").className = failureText ? "dot dot-bad" : "dot dot-ok";
  $("#credential-chip-text").textContent =
    failureText ||
    {
      api: `Claude · API key ••${app.apiKeyTail}`,
      cloud: `Claude · ${app.provider}`,
      cli: "Claude · Claude Code in a terminal",
    }[app.credential];
}
