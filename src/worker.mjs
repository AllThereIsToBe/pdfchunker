import fs from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";
import { PDFDocument } from "pdf-lib";
import { renderChunkBytes } from "./core.mjs";

async function run() {
  const { inputPath, tasks } = workerData;
  const sourceBytes = await fs.readFile(inputPath);
  const sourceDoc = await PDFDocument.load(sourceBytes);
  const results = [];

  for (const task of tasks) {
    const bytes = await renderChunkBytes(sourceDoc, task.startPage, task.endPage);
    await fs.writeFile(task.outputPath, bytes);

    const result = {
      index: task.index,
      startPage: task.startPage,
      endPage: task.endPage,
      outputPath: task.outputPath,
      fileName: task.fileName,
      bytes: bytes.length,
    };

    results.push(result);
    parentPort.postMessage({ type: "progress", result });
  }

  parentPort.postMessage({ ok: true, results });
}

run().catch((error) => {
  parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  });
});
