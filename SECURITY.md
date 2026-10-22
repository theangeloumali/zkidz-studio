<!-- Created by The Angelo Umali. -->

# Security policy

ZKidz Studio runs on your own machine. It starts a local web server, drives Claude on your behalf and reads and writes your
footage, so a bug in it can reach your files and your Claude access. Please report anything that looks like a security problem
privately, using the process below.

## Supported versions

The project is pre-alpha. There is no release yet, so nothing is supported for production use.

| Version                 | Security fixes                                     |
| ----------------------- | -------------------------------------------------- |
| `develop` (pre-release) | Yes. Fixes land here first.                        |
| Latest `1.x` release    | Yes, once 1.0 ships. Fixes ship as a patch release |
| Any older release       | No. Upgrade to the latest release                  |

## Reporting a vulnerability

Use GitHub private vulnerability reporting:
[Report a vulnerability](https://github.com/theangeloumali/zkidz-studio/security/advisories/new) (the **Security** tab, then
**Report a vulnerability**).

Do not open a public issue, pull request or discussion for a security problem, and do not put exploit details in one.

A useful report includes:

- the version or commit, your OS, and how you installed and started the app;
- the auth mode in use (API key, Claude Code login, or terminal mode) if the agent is involved;
- steps to reproduce, and what an attacker gains;
- a proof of concept, if you have one. Use test credentials and test data only. Never send a real API key, token or someone
  else's footage.

## What to expect

These are targets for a single-maintainer project, not guarantees.

| Step                                | Target                     |
| ----------------------------------- | -------------------------- |
| Acknowledge your report             | 5 business days            |
| Confirm or reject, with a severity  | 10 business days           |
| Fix released for a critical or high | 30 days after confirmation |
| Fix released for a medium or low    | 90 days after confirmation |

We keep you updated in the advisory thread, agree a disclosure date with you, publish a GitHub security advisory (with a CVE
where one applies) when the fix ships, and credit you unless you ask us not to. If a fix will miss its target, we tell you why
and when to expect it.

## Scope

In scope: everything in this repository, including:

- **The local server** (`127.0.0.1:4317`) and the preview origin (`127.0.0.1:4318`): reaching the API from another website
  (CSRF, DNS rebinding, missing `Host` or `Origin` checks), clickjacking, path traversal through uploads or `/api/media`, script
  running on the app origin, or the server listening on anything other than loopback.
- **Agent permissions**: the agent getting a tool it should not have (Bash, Edit, Write, web tools), reading files outside the
  project or plugin folder, skipping an approval card for render, export or delete, or being steered into any of these by
  prompt injection in a transcript, filename or media metadata.
- **Terminal mode**: the terminal pane running anything other than the resolved `claude` binary, the WebSocket accepting a
  connection without a valid single-use ticket, or a forged hook or MCP call being accepted.
- **Credential handling**: any path that reads, stores, logs, proxies or sends to the browser a Claude credential or API key,
  beyond the last four characters the UI shows.
- **The engine and downloads**: ffmpeg reading files or URLs it was not given, and any binary or model installed without its
  pinned SHA-256 being checked.
- **The optional Supabase backend**: Postgres, Studio or any other container reachable from outside loopback.
- **CI and releases**: workflow permissions, action pinning, release artifacts and their provenance.

Out of scope:

- Vulnerabilities in Claude Code, the Claude Agent SDK or Anthropic's services. Report those to Anthropic. Tell us too if the way
  this app uses them makes the problem worse.
- Vulnerabilities in ffmpeg, Chrome, Supabase, Docker or other upstream software, unless our configuration or usage creates or
  widens the exposure. Report the upstream bug upstream.
- Attacks that already need code execution as your user, or administrator access, on the machine running the app.
- Problems that only exist after you change the code to bind a non-loopback address or turn off a documented safeguard.
- The local Supabase default password, only while Postgres is unreachable from every non-loopback interface. If you can reach it
  from outside loopback, that is in scope.
- Denial of service a local user causes against their own instance, social engineering, and physical access.

## How the app handles credentials and agent permissions

The design is in the plan of record,
[`docs/plans/zkidz-studio-platform-plan-2026-10-22.md`](docs/plans/zkidz-studio-platform-plan-2026-10-22.md) (§6.10 permission
policy, §11 threat model). Each control lands with the phase that builds its feature. A report that the running code falls short
of any statement below is in scope.

- **Claude login.** The app never reads, stores or proxies Claude Code's own login. Claude Code handles its own `/login`.
- **API key.** Stored in the OS keychain (Credential Manager on Windows) or in a `0600` file on macOS and Linux. The app refuses
  to store it on a Windows drive mounted into WSL, where file permissions are not enforced. It never goes into the database,
  logs, events or the browser. Child processes get an environment built from an allowlist.
- **Terminal mode tokens.** Each session gets random hook and MCP tokens that live only in the terminal process environment and
  are compared in constant time. The settings files it writes hold no secret and are deleted when the session ends.
- **Agent tools.** The agent gets `Read`, `Skill`, `AskUserQuestion` and the app's own MCP tools. Bash, Edit, Write, WebFetch,
  WebSearch and Agent are denied. Any other tool request is denied by default. Render, export and delete need your approval on a
  card. Reads are confined to the project and plugin folders. A session aborts at start if its tool set differs from this list.
  The app never uses `bypassPermissions`.
- **This repository.** It is public. GitHub secret scanning and push protection are on, and gitleaks scans every push and pull
  request (`.github/workflows/gitleaks.yml`, rules in `.gitleaks.toml`). Contributors can run the same check before pushing:
  `gitleaks git --no-banner`.

If you find a secret committed to this repository, report it privately as above rather than in an issue.
