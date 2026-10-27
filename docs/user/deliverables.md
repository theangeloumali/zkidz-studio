<!-- Created by The Angelo Umali. -->

# Deliverables

For anyone uploading the finished video. Last reviewed 2026-10-24.

An export writes to `ZKS_HOME/projects/<project>/deliverables/`. **Open folder** on the Render screen opens it in your file
manager.

| File                                     | What it is                                           |
| ---------------------------------------- | ---------------------------------------------------- |
| `<project>-<resolution>.mp4`             | The full edit; resolution is `4k`, `1080` or `draft` |
| `reels-<project>-<resolution>.mp4`       | The Reels cut                                        |
| `cover-A.png`, `cover-B.png`             | Covers for the full edit                             |
| `reels-cover-A.png`, `reels-cover-B.png` | Covers for the Reels cut                             |
| `caption.txt`                            | The post caption, shared by both cuts                |

Only the `nvidia` backend renders a true 4K master today; on other backends a `4k` request produces a 1080 master.

The app hashes each file while copying it and lists the SHA-256 on the Render screen. Only a master that passed its checks is
copied. If the master on disk changed after the checks ran, the export stops instead of shipping it. A file appears only once it
is fully written, so you never pick up a half-copied video.

To confirm a copy you moved elsewhere, compare its hash with the one on screen:

```bash
sha256sum <file>          # macOS: shasum -a 256 <file>; Windows: certutil -hashfile <file> SHA256
```
