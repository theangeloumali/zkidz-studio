<!-- Created by The Angelo Umali. -->

# Privacy and security

For anyone deciding whether to trust ZKidz Studio with their footage and Claude access. Last reviewed 2026-10-24.

## Local-first

Your footage, projects, renders and database stay in `ZKS_HOME` on your machine. The only network traffic in normal use is:

- calls to Claude, through the mode you chose;
- one-time downloads during setup (tools and models, each checked against a SHA-256 in `tools.lock.json`).

Telemetry for the bundled renderer is turned off (`HYPERFRAMES_NO_TELEMETRY=1`, `DO_NOT_TRACK=1`).

## Loopback only

The server binds `127.0.0.1`. It refuses to start on any other address, so nothing on your network can reach it. Inside the
Docker image it binds the container's own interface, and compose publishes it on `127.0.0.1` only ([Docker](docker.md)).

Requests from other websites are refused: writes need the app's own origin and a per-launch token, reads reject cross-site
fetches, and an unknown `Host` header is turned away, which stops DNS rebinding.

## Your Claude credentials

- Mode A: the key goes in your OS keychain (on macOS and Linux without one, an owner-only file in `ZKS_HOME`). It never reaches
  the database, logs or browser, which shows only the last four characters.
- Mode B: the app stores nothing; your cloud CLI holds the credentials.
- Mode T: the app never reads, stores or passes on your Claude Code sign-in.

## What the agent can and cannot touch

| The agent can                                           | The agent cannot                                            |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| Read the current project's media, transcripts and specs | Run shell commands, or edit and write files directly        |
| Write specs through the studio's own tools              | Browse the web                                              |
| Propose cuts, renders and exports                       | Render, export or delete without your approval card         |
| Ask you questions                                       | Read outside the project folder, or your home and `.claude` |
|                                                         | Create or change your rules                                 |

Text from transcripts, filenames and file metadata reaches the agent marked as data, not instructions, so a clip that says
"delete everything" is treated as speech. Anything the agent writes is shown as plain text, never run as code in the page.

## Reporting a problem

Report security issues privately, as described in [SECURITY.md](../../SECURITY.md).
