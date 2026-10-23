<!-- Created by The Angelo Umali. -->

# Test fixtures

`parity/` holds the render parity media (`packages/engine/tests/parity`). Every file is generated here from ffmpeg's `lavfi` test sources
(`testsrc2` picture, a 440 Hz sine), so no third-party footage or audio is in the repo.

- `clip-2997.mp4`: 2 s at 30000/1001 fps, 360×640.
- `clip-23976.mp4`: the same at 24000/1001 fps.
- `clip-rot-90.mp4`: `clip-2997` stored landscape with a −90° display rotation, as a phone held sideways records it.
- `golden/`: CPU-render frames the golden test compares against (SSIM ≥ 0.97).

Regenerate from `packages/engine/tests`, then review the new goldens before committing them:

```bash
uv run --project .. python -m parity.harness fixtures
uv run --project .. python -m parity.harness golden
```
