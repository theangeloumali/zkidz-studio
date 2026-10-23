<!-- Created by The Angelo Umali. -->

# Connecting Claude to ZKidz Studio

For anyone setting up ZKidz Studio for the first time, or changing how it reaches Claude. Last reviewed 2026-10-23.

ZKidz Studio needs Claude to plan and build your edits. You connect it in one of three ways on the Connect Claude screen. Mode A,
your own API key, is the default and the one we recommend.

| Mode | You bring                                          | Who pays                                   | Status                                       |
| ---- | -------------------------------------------------- | ------------------------------------------ | -------------------------------------------- |
| A    | A Claude Console API key                           | Your Console account (or included credits) | Recommended, first card                      |
| B    | Your own Bedrock, Vertex, Foundry or Claude on AWS | Your cloud account                         | Advanced, second card                        |
| T    | Claude Code installed on this computer, signed in  | Your Claude plan's usage limits            | Opt-in, pending Anthropic's written approval |

## Mode A: your own API key

What you need: an API key from the Claude Console. Max and Team users can create one that draws on their included API credits.

1. Open Setup and pick the "Claude API key" card.
2. Paste the key and press Connect.

```text
Connect Claude  >  Claude API key  >  [ paste key ]  >  Connect
```

The app checks the key with one call to `https://api.anthropic.com/v1/models`, which costs no tokens. A good key is saved in your
operating system's keychain (Credential Manager on Windows). On macOS and Linux without a keychain, it goes to
`ZKS_HOME/secrets.env` with owner-only permissions; the app refuses that fallback on a Windows drive mounted in WSL (`/mnt/*`).
After saving, the browser only ever shows the last four characters.

The app shows an estimated cost per turn and per project. It is an estimate, not your bill; check the Console usage page for real
billing.

What the app never touches: your other environment variables. The agent gets the key in its own environment and nothing from your
shell, so a stray `ANTHROPIC_*` variable cannot override your choice.

## Mode B: your own cloud provider

What you need: a working Bedrock, Vertex, Foundry or Claude Platform on AWS setup, signed in through that provider's own CLI.

Pick the "Use my cloud provider" card and choose the provider. The app sets that provider's `CLAUDE_CODE_USE_*` switch and the
provider's documented variables for the agent. Credentials come from your cloud CLI profile.

What the app never touches: cloud secrets. It stores none. If the agent has not started within 30 seconds, the card shows a link to
the provider's setup guide.

## Mode T: terminal mode

What you need: Claude Code 2.1.295 or newer, installed by you ([setup guide](https://code.claude.com/docs/en/setup)), and a Claude
subscription or any other sign-in Claude Code offers.

Terminal mode is off until you turn it on. Anthropic's terms do not plainly cover this setup, so we asked Anthropic for written
approval. The request is still open. If Anthropic says no, mode T is removed before the next release, and modes A and B keep working.

How it works: the app starts the `claude` program you installed, unmodified, in a terminal pane inside the Editor. You sign in there
with Claude Code's own `/login`. The app watches the build through its own tools and hooks; it never reads the terminal text for
meaning.

1. Pick the "Terminal mode" card. It shows the `claude` version it found.
2. Read the disclosure and tick "I understand".
3. Open a project. Claude Code asks whether you trust the project folder. Choose "Yes, I trust this folder". The highlighted
   default exits.
4. If Claude Code asks you to sign in, type `/login` in the pane and finish Anthropic's sign-in.

```text
> /login
```

There is no cost meter in mode T. Type `/usage` in the pane to see your plan usage. Stop interrupts the current turn and keeps the
session; Kill closes the terminal. Reopening a project resumes its session.

What the app never does in mode T:

- offer or build its own Claude login;
- read or store your credentials, the OS keychain entry, or anything in `~/.claude`;
- pass on or proxy any token;
- change the Claude Code program;
- run Claude for anyone except the person at this computer;
- accept terminal input from any page except the app's own.

## Switching modes

Open Setup and pick a different card. Each mode works on its own, so the change applies to the next agent session you start. If
mode T cannot find Claude Code, or you hit your plan's limit, the app offers mode A.

## What no mode allows

The app never offers "Sign in with Claude", never accepts a pasted `setup-token` or imported credential files, and never shares or
hosts accounts. Anthropic's terms forbid apps from collecting or passing on Claude.ai credentials.

## UI copy for the Connect Claude screen

Hand-off for `apps/web/src/copy/claude.ts` (owner: lena). Use these strings exactly. The mode T disclosure is verbatim from plan §6.4.

| Key                     | String                                                                                                                                                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `screen.title`          | Connect Claude                                                                                                                                                                                                                                                                |
| `modeA.title`           | Claude API key                                                                                                                                                                                                                                                                |
| `modeA.badge`           | Recommended                                                                                                                                                                                                                                                                   |
| `modeA.body`            | Paste your own Claude Console API key. Max and Team plans can create one that uses their included API credits.                                                                                                                                                                |
| `modeA.saved`           | Key saved. Ends in {last4}.                                                                                                                                                                                                                                                   |
| `modeA.badKey`          | That key did not work. Check it in the Claude Console and paste it again.                                                                                                                                                                                                     |
| `modeA.noCredit`        | Your Console account is out of credit. Add credit in Console billing, or create a key that uses your Max or Team credits.                                                                                                                                                     |
| `modeB.title`           | Use my cloud provider                                                                                                                                                                                                                                                         |
| `modeB.badge`           | Advanced                                                                                                                                                                                                                                                                      |
| `modeB.body`            | Use your own Bedrock, Vertex, Foundry or Claude Platform on AWS setup. ZKidz Studio stores no cloud secret.                                                                                                                                                                   |
| `modeB.timeout`         | Claude did not start through your provider within 30 seconds. Check your provider setup.                                                                                                                                                                                      |
| `modeT.title`           | Terminal mode                                                                                                                                                                                                                                                                 |
| `modeT.badge`           | Opt-in · pending Anthropic approval                                                                                                                                                                                                                                           |
| `modeT.disclosure`      | Terminal mode runs the Claude Code you installed, unmodified, in a terminal inside ZKidz Studio. You sign in there with Claude Code's own /login. ZKidz Studio never sees or stores your credentials. Usage counts against your Claude plan's limits. Read Anthropic's terms. |
| `modeT.disclosureLinks` | https://code.claude.com/docs/en/legal-and-compliance · https://code.claude.com/docs/en/agent-sdk/overview · the Anthropic help article on subscription use                                                                                                                    |
| `modeT.ack`             | I understand                                                                                                                                                                                                                                                                  |
| `modeT.version`         | Found Claude Code {version}                                                                                                                                                                                                                                                   |
| `modeT.missing`         | Claude Code is not installed, or is older than 2.1.295. Install it, or use an API key instead.                                                                                                                                                                                |
| `modeT.trustHint`       | Claude Code asks whether you trust this project folder. Choose 'Yes, I trust this folder'; the highlighted default exits. Then sign in with /login if asked.                                                                                                                  |
| `modeT.signInHint`      | Sign in inside the terminal with /login                                                                                                                                                                                                                                       |
| `modeT.usage`           | Usage counts against your Claude plan. Type /usage in the terminal to see it.                                                                                                                                                                                                 |
| `modeT.exited`          | The terminal closed (exit code {code}).                                                                                                                                                                                                                                       |
| `modeT.restart`         | Restart                                                                                                                                                                                                                                                                       |
| `limit.hit`             | You reached your plan's limit. It resets in {countdown}. You can switch to an API key meanwhile.                                                                                                                                                                              |
| `usage.estimate`        | ≈ {turnCost} this turn · ≈ {projectCost} this project (estimate)                                                                                                                                                                                                              |
