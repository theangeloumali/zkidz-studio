<!-- Created by The Angelo Umali. -->

# Mock-up approval

Approved by Angelo on 2026-10-23, in the build session:

> "Also approve. I already approved the markup"

This closes the Phase 0 gate (plan §14). The approved reference is this folder as committed, and the app builds against it.

## Screens covered (plan §9.1)

| #   | Screen          | App route         | Reference stills                     |
| --- | --------------- | ----------------- | ------------------------------------ |
| 1   | Connect Claude  | `/setup`          | `screens/01`–`04`, `26`              |
| 1b  | First render    | `/setup`          | `screens/05`, `32`                   |
| 1c  | Pick a style    | `/setup/style`    | `screens/06`                         |
| 2   | Home            | `/`               | `screens/07`–`11`, `30`              |
| 3   | Editor          | `/p/:slug`        | `screens/12`–`20`, `27`–`29`         |
| 3b  | Rules           | `/p/:slug/rules`  | `screens/21`                         |
| 4   | Render & export | `/p/:slug/export` | `screens/22`–`25`, `31`              |
| —   | Shared states   | all               | `screens/33` focus ring, `34` states menu |
