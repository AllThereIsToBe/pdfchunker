import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { prepareChunkJob, runPreparedChunkJob } from "../core.mjs";
import {
  detectDefaultJobs,
  formatBytes,
  parsePositiveInteger,
  parseSize,
} from "../shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow() {
  const window = new BrowserWindow({
    width: 1360,
    height: 920,
    minWidth: 1120,
    minHeight: 760,
    title: "PDF Chunker",
    backgroundColor: "#09131a",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  window.loadFile(path.join(__dirname, "index.html"));
}

function normalizeJobInput(rawArgs) {
  if (!rawArgs?.inputPath) {
    throw new Error("Choose a PDF file first.");
  }

  const mode = rawArgs.mode;
  if (!mode || !["pages", "bytes", "chars"].includes(mode)) {
    throw new Error("Mode must be pages, bytes, or chars.");
  }

  const args = {
    inputPath: path.resolve(String(rawArgs.inputPath)),
    outputDir: rawArgs.outputDir ? path.resolve(String(rawArgs.outputDir)) : undefined,
    prefix: rawArgs.prefix ? String(rawArgs.prefix).trim() : undefined,
    mode,
    jobs: rawArgs.jobs
      ? parsePositiveInteger(String(rawArgs.jobs), "jobs")
      : detectDefaultJobs(),
    overwrite: Boolean(rawArgs.overwrite),
    validate: Boolean(rawArgs.validate),
  };

  if (mode === "pages") {
    args.pagesPerChunk = parsePositiveInteger(
      String(rawArgs.pagesPerChunk ?? ""),
      "pages-per-chunk",
    );
  }

  if (mode === "bytes") {
    args.maxBytes = parseSize(String(rawArgs.maxSize ?? ""));
  }

  if (mode === "chars") {
    args.maxChars = parsePositiveInteger(String(rawArgs.maxChars ?? ""), "max-chars");
  }

  return args;
}

function serializeTask(task) {
  return {
    index: task.index,
    fileName: task.fileName,
    outputPath: task.outputPath,
    startPage: task.startPage,
    endPage: task.endPage,
    pageCount: task.endPage - task.startPage + 1,
    plannedBytes: task.plannedBytes ?? null,
    plannedBytesLabel:
      typeof task.plannedBytes === "number" ? formatBytes(task.plannedBytes) : null,
    plannedChars: task.plannedChars ?? null,
  };
}

function serializePrepared(prepared, args) {
  const chunks = prepared.tasks.map(serializeTask);
  const totalPlannedBytes = chunks.reduce(
    (sum, chunk) => sum + (typeof chunk.plannedBytes === "number" ? chunk.plannedBytes : 0),
    0,
  );

  return {
    mode: args.mode,
    inputPath: prepared.inputPath,
    outputDir: prepared.outputDir,
    prefix: prepared.prefix,
    pageCount: prepared.pageCount,
    chunkCount: chunks.length,
    warnings: prepared.warnings,
    jobs: args.jobs,
    overwrite: args.overwrite,
    validate: args.validate,
    totals: {
      plannedBytes: totalPlannedBytes,
      plannedBytesLabel: totalPlannedBytes > 0 ? formatBytes(totalPlannedBytes) : null,
    },
    chunks,
  };
}

function serializeResult(result) {
  return {
    index: result.index,
    fileName: result.fileName,
    outputPath: result.outputPath,
    startPage: result.startPage,
    endPage: result.endPage,
    pageCount: result.endPage - result.startPage + 1,
    bytes: result.bytes,
    bytesLabel: formatBytes(result.bytes),
  };
}

function registerIpc() {
  ipcMain.handle("app:getDefaults", async () => ({
    jobs: detectDefaultJobs(),
    platform: process.platform,
  }));

  ipcMain.handle("dialog:pickPdf", async () => {
    const selected = await dialog.showOpenDialog({
      title: "Choose a PDF to chunk",
      properties: ["openFile"],
      filters: [{ name: "PDF Files", extensions: ["pdf"] }],
    });

    return selected.canceled ? null : selected.filePaths[0];
  });

  ipcMain.handle("dialog:pickOutputDir", async () => {
    const selected = await dialog.showOpenDialog({
      title: "Choose output folder",
      properties: ["openDirectory", "createDirectory"],
    });

    return selected.canceled ? null : selected.filePaths[0];
  });

  ipcMain.handle("chunker:plan", async (_event, rawArgs) => {
    const args = normalizeJobInput(rawArgs);
    const prepared = await prepareChunkJob(args);
    return serializePrepared(prepared, args);
  });

  ipcMain.handle("chunker:run", async (event, rawArgs) => {
    const args = normalizeJobInput(rawArgs);
    const prepared = await prepareChunkJob(args);
    const preparedPayload = serializePrepared(prepared, args);

    event.sender.send("chunker:progress", {
      phase: "starting",
      plan: preparedPayload,
      completedCount: 0,
      totalTasks: prepared.tasks.length,
      percent: 0,
    });

    const completed = await runPreparedChunkJob(prepared, {
      ...args,
      onProgress(progress) {
        event.sender.send("chunker:progress", {
          phase: "writing",
          completedCount: progress.completedCount,
          totalTasks: progress.totalTasks,
          percent: Math.round((progress.completedCount / progress.totalTasks) * 100),
          result: serializeResult(progress.result),
        });
      },
    });

    const results = completed.results.map(serializeResult);
    const totalWrittenBytes = results.reduce((sum, result) => sum + result.bytes, 0);

    return {
      ...preparedPayload,
      results,
      totals: {
        ...preparedPayload.totals,
        writtenBytes: totalWrittenBytes,
        writtenBytesLabel: formatBytes(totalWrittenBytes),
      },
    };
  });

  ipcMain.handle("shell:openPath", async (_event, targetPath) => {
    if (!targetPath) {
      throw new Error("Path is required.");
    }

    return shell.openPath(String(targetPath));
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
