// Created by The Angelo Umali.
// The server's long-lived preview builder: loads the composition modules once (fontkit alone takes ~1.5 s on a Windows mount)
// and answers {id, work, video} messages over IPC with {id, ok, error?}.
const { buildPreview } = require("./index");

process.on("message", ({ id, work, video }) => {
  try {
    buildPreview({ work, video });
    process.send({ id, ok: true });
  } catch (error) {
    process.send({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
