import fs from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { PDFDocument } from "pdf-lib";
import {
  buildPageRange,
  chunkByPageCount,
  chunkByRunningTotal,
  defaultOutputDir,
  formatBytes,
  makeChunkFileName,
  partitionIntoBatches,
  sanitizePrefix,
} from "./shared.mjs";

export async function loadSource(inputPath) {
  const sourceBytes = await fs.readFile(inputPath);
  const sourceDoc = await PDFDocument.load(sourceBytes);
  const pageCount = sourceDoc.getPageCount();

  if (pageCount === 0) {
    throw new Error("Input PDF has no pages.");
  }

  return { sourceBytes, sourceDoc, pageCount };
}

export async function renderChunkBytes(sourceDoc, startPage, endPage) {
  const outputDoc = await PDFDocument.create();
  const pageIndices = buildPageRange(startPage, endPage);
  const copiedPages = await outputDoc.copyPages(sourceDoc, pageIndices);
  for (const page of copiedPages) {
    outputDoc.addPage(page);
  }

  return outputDoc.save({
    useObjectStreams: true,
    updateFieldAppearances: false,
  });
}

async function extractPageCharCounts(sourceBytes, pageCount) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(sourceBytes),
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const charCounts = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    charCounts.push(text.length);
  }

  return charCounts;
}

async function measureChunkBytes(sourceDoc, startPage, endPage, cache) {
  const key = `${startPage}:${endPage}`;
  if (cache.has(key)) {
    return cache.get(key);
  }

  const bytes = await renderChunkBytes(sourceDoc, startPage, endPage);
  const size = bytes.length;
  cache.set(key, size);
  return size;
}

async function planChunksByByteSize(sourceDoc, pageCount, maxBytes) {
  const chunks = [];
  const warnings = [];
  const cache = new Map();
  let startPage = 1;

  while (startPage <= pageCount) {
    let low = startPage;
    let high = pageCount;
    let bestEnd = null;
    let bestSize = null;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const size = await measureChunkBytes(sourceDoc, startPage, mid, cache);
      if (size <= maxBytes) {
        bestEnd = mid;
        bestSize = size;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (bestEnd === null) {
      const size = await measureChunkBytes(sourceDoc, startPage, startPage, cache);
      warnings.push(
        `Page ${startPage} alone is ${formatBytes(size)}, above the requested limit of ${formatBytes(maxBytes)}.`,
      );
      chunks.push({
        startPage,
        endPage: startPage,
        plannedBytes: size,
      });
      startPage += 1;
      continue;
    }

    while (bestEnd < pageCount) {
      const nextSize = await measureChunkBytes(sourceDoc, startPage, bestEnd + 1, cache);
      if (nextSize <= maxBytes) {
        bestEnd += 1;
        bestSize = nextSize;
      } else {
        break;
      }
    }

    chunks.push({
      startPage,
      endPage: bestEnd,
      plannedBytes: bestSize,
    });
    startPage = bestEnd + 1;
  }

  return { chunks, warnings };
}

export async function buildChunkPlan({
  inputPath,
  mode,
  pagesPerChunk,
  maxBytes,
  maxChars,
}) {
  const { sourceBytes, sourceDoc, pageCount } = await loadSource(inputPath);
  let plan;

  if (mode === "pages") {
    plan = chunkByPageCount(pageCount, pagesPerChunk);
  } else if (mode === "bytes") {
    plan = await planChunksByByteSize(sourceDoc, pageCount, maxBytes);
  } else if (mode === "chars") {
    const pageCharCounts = await extractPageCharCounts(sourceBytes, pageCount);
    const totalChars = pageCharCounts.reduce((sum, value) => sum + value, 0);
    plan = chunkByRunningTotal(pageCharCounts, maxChars, "Chars");
    if (totalChars === 0) {
      plan.warnings.push(
        "No extractable text was found. This is common for scanned or image-only PDFs; use pages or bytes mode if the result is not useful.",
      );
    }
  } else {
    throw new Error(`Unsupported mode: ${mode}`);
  }

  const parsed = path.parse(inputPath);
  const prefix = sanitizePrefix(parsed.name) || "chunk";
  const chunks = plan.chunks.map((chunk, index) => ({
    index,
    ...chunk,
    fileName: makeChunkFileName(prefix, index, chunk.startPage, chunk.endPage, pageCount),
  }));

  return {
    pageCount,
    prefix,
    chunks,
    warnings: plan.warnings,
    inputPath,
  };
}

export async function prepareChunkJob(args) {
  const plan = await buildChunkPlan(args);
  const output = resolveOutputSettings(
    args.inputPath,
    args.outputDir,
    args.prefix,
    plan.pageCount,
    plan.chunks,
  );

  return {
    inputPath: args.inputPath,
    mode: args.mode,
    pageCount: plan.pageCount,
    warnings: plan.warnings,
    prefix: output.prefix,
    outputDir: output.outputDir,
    tasks: output.tasks,
  };
}

export function resolveOutputSettings(inputPath, outputDir, prefixOverride, pageCount, chunks) {
  const outputPath = outputDir ? path.resolve(outputDir) : defaultOutputDir(path.resolve(inputPath));
  const prefix = prefixOverride ? sanitizePrefix(prefixOverride) : sanitizePrefix(path.parse(inputPath).name);
  const normalizedPrefix = prefix || "chunk";

  return {
    outputDir: outputPath,
    tasks: chunks.map((chunk) => {
      const fileName = makeChunkFileName(
        normalizedPrefix,
        chunk.index,
        chunk.startPage,
        chunk.endPage,
        pageCount,
      );

      return {
        ...chunk,
        fileName,
        outputPath: path.join(outputPath, fileName),
      };
    }),
    prefix: normalizedPrefix,
  };
}

export async function ensureOutputTargets(tasks, outputDir, overwrite) {
  await fs.mkdir(outputDir, { recursive: true });

  if (!overwrite) {
    for (const task of tasks) {
      try {
        await fs.access(task.outputPath);
        throw new Error(`Refusing to overwrite existing file: ${task.outputPath}`);
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }
  }
}

function spawnWorker(workerUrl, workerData, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, { workerData });
    let finished = false;

    worker.on("message", (message) => {
      if (message?.type === "progress") {
        onProgress?.(message.result);
        return;
      }

      finished = true;
      if (message.ok) {
        resolve(message.results);
      } else {
        reject(new Error(message.error));
      }
    });

    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0 && !finished) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });
  });
}

export async function writeChunksInParallel({
  inputPath,
  tasks,
  outputDir,
  overwrite,
  jobs,
  validate,
  onProgress,
}) {
  const workerCount = Math.min(Math.max(1, jobs), tasks.length);
  const workerUrl = new URL("./worker.mjs", import.meta.url);
  const batches = partitionIntoBatches(tasks, workerCount);
  let completedCount = 0;
  const workerRuns = batches.map((batch) =>
    spawnWorker(workerUrl, {
      inputPath,
      outputDir,
      overwrite,
      validate,
      tasks: batch,
    }, (result) => {
      completedCount += 1;
      onProgress?.({
        completedCount,
        totalTasks: tasks.length,
        result,
      });
    }),
  );

  const settled = await Promise.all(workerRuns);
  return settled.flat().sort((left, right) => left.index - right.index);
}

export async function validateChunkFiles(results) {
  for (const result of results) {
    const bytes = await fs.readFile(result.outputPath);
    const pdf = await PDFDocument.load(bytes);
    const pageCount = pdf.getPageCount();
    const expectedPages = result.endPage - result.startPage + 1;
    if (pageCount !== expectedPages) {
      throw new Error(
        `Validation failed for ${result.outputPath}: expected ${expectedPages} pages, found ${pageCount}.`,
      );
    }
  }
}

export async function runPreparedChunkJob(prepared, args) {
  await ensureOutputTargets(prepared.tasks, prepared.outputDir, args.overwrite);

  const results = await writeChunksInParallel({
    inputPath: prepared.inputPath,
    tasks: prepared.tasks,
    outputDir: prepared.outputDir,
    overwrite: args.overwrite,
    jobs: args.jobs,
    validate: args.validate,
    onProgress: args.onProgress,
  });

  if (args.validate) {
    await validateChunkFiles(results);
  }

  return {
    ...prepared,
    results,
  };
}

export async function runChunkJob(args) {
  const prepared = await prepareChunkJob(args);
  return runPreparedChunkJob(prepared, args);
}
