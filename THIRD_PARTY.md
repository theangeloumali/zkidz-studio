<!-- Created by The Angelo Umali. -->

# Third-party notices

This file lists software, fonts and data that ZKidz Studio uses, and says whether each is in this repository or downloaded at setup.
Package dependencies installed by pnpm and uv keep their own licences in their lockfiles and package metadata.

| Component                      | Licence                                 | In this repo?                               | Notes                                                                                                  |
| ------------------------------ | --------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Archivo (font)                 | SIL Open Font License 1.1               | Yes, when a theme bundles it                | The OFL text ships beside the font files in each theme's `fonts/` folder.                              |
| JetBrains Mono (font)          | SIL Open Font License 1.1               | Yes, when a theme bundles it                | Same as above.                                                                                         |
| Newsreader (font)              | SIL Open Font License 1.1               | Yes, when a theme bundles it                | Same as above.                                                                                         |
| Caveat (font)                  | SIL Open Font License 1.1               | Yes, in `packages/engine/hf/kit/fonts/`     | The OFL text ships beside the font file.                                                               |
| Inter (font)                   | SIL Open Font License 1.1               | Yes, in `packages/engine/hf/overlay/fonts/` | Same as above.                                                                                         |
| Lucide icons                   | ISC                                     | Yes, as inlined icon paths                  | https://lucide.dev                                                                                     |
| HyperFrames                    | See its package licence                 | No, installed by pnpm                       | Renders overlay frames in headless Chrome.                                                             |
| chrome-headless-shell          | Chromium licences                       | No, downloaded by setup                     | Pinned by version and SHA-256 in `tools.lock.json`.                                                    |
| FFmpeg                         | GPL build (never the `nonfree` variant) | No, downloaded by setup                     | Pinned by URL and SHA-256. ZKidz Studio runs it as a separate program and does not link to it.         |
| whisper.cpp (`whisper-cli`)    | MIT                                     | No, downloaded by setup                     | Pinned by URL and SHA-256.                                                                             |
| Whisper ggml models            | MIT (OpenAI Whisper weights)            | No, downloaded on first transcription       | Pinned by URL and SHA-256.                                                                             |
| Claude Code / Claude Agent SDK | Anthropic's terms                       | No                                          | You install and sign in to Claude Code yourself. The repository holds no Claude binary or credentials. |

## herk-edit-kit

Nate Herk's [herk-edit-kit](https://github.com/nateherkai/herk-edit-kit) influenced a few editing ideas, such as review-gated cuts and
a first-three-seconds check. Nothing from it is included: no text, cards, templates or scripts. Every feature here is written from
scratch on this project's engine.
