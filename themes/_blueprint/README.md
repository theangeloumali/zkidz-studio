<!-- Created by The Angelo Umali. -->

# Theme blueprint

The copy-me starter for a new theme pack. It is never loaded or indexed as it stands (its folder starts with `_`).

1. Copy this folder to `themes/<your-id>/` (lowercase letters, digits and `-`).
2. Set `id` in `theme.json` to the folder name, and give it a `name` and `description`.
3. Edit `tokens` (colours) and `type` (bundled faces only), and choose `boil` and `intro`.
4. List the kinds your theme draws under `components`, each with a `tier`, a `purpose` and `maxChars` per text slot. Start from
   `themes/zkidz/theme.json` for the full set.
5. Run `zks-engine theme-index --json` and commit `theme.json` with the generated `index.json`.

The contract is in [`themes/README.md`](../README.md).
