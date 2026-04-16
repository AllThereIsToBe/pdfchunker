import os from "node:os";
import path from "node:path";

const SIZE_UNITS = new Map([
  ["b", 1],
  ["byte", 1],
  ["bytes", 1],
  ["kb", 1_000],
  ["mb", 1_000_000],
  ["gb", 1_000_000_000],
  ["tb", 1_000_000_000_000],
  ["kib", 1_024],
  ["mib", 1_048_576],
  ["gib", 1_073_741_824],
  ["tib", 1_099_511_627_776],
]);

export function parsePositiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

export function parseSize(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Size value is required.");
  }

  const normalized = value.trim().toLowerCase().replaceAll(" ", "");
  const match = normalized.match(/^(\d+(?:\.\d+)?)([a-z]+)?$/);
  if (!match) {
    throw new Error(`Invalid size value: ${value}`);
  }

  const numeric = Number.parseFloat(match[1]);
  const unit = match[2] ?? "b";
  const multiplier = SIZE_UNITS.get(unit);
  if (!multiplier) {
    throw new Error(`Unsupported size unit: ${unit}`);
  }

  const bytes = Math.floor(numeric * multiplier);
  if (bytes <= 0) {
    throw new Error(`Size must be greater than zero: ${value}`);
  }

  return bytes;
}

export function formatBytes(bytes) {
  if (bytes < 1_000) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = "B";
  for (const candidate of units) {
    value /= 1_000;
    unit = candidate;
    if (value < 1_000) {
      break;
    }
  }

  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${unit}`;
}

export function defaultOutputDir(inputPath) {
  const parsed = path.parse(inputPath);
  return path.join(parsed.dir, `${parsed.name}_chunks`);
}

export function sanitizePrefix(value) {
  return value
    .replaceAll(/[^a-zA-Z0-9._-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function detectDefaultJobs() {
  return Math.max(1, os.availableParallelism?.() ?? os.cpus().length ?? 1);
}

export function makeChunkFileName(prefix, index, startPage, endPage, totalPages) {
  const chunkDigits = Math.max(4, String(index + 1).length);
  const pageDigits = Math.max(4, String(totalPages).length);
  const chunkId = String(index + 1).padStart(chunkDigits, "0");
  const start = String(startPage).padStart(pageDigits, "0");
  const end = String(endPage).padStart(pageDigits, "0");

  return `${prefix}.part-${chunkId}.p${start}-${end}.pdf`;
}

export function chunkByPageCount(totalPages, pagesPerChunk) {
  const chunks = [];
  for (let startPage = 1; startPage <= totalPages; startPage += pagesPerChunk) {
    const endPage = Math.min(totalPages, startPage + pagesPerChunk - 1);
    chunks.push({ startPage, endPage });
  }
  return { chunks, warnings: [] };
}

export function chunkByRunningTotal(pageMetrics, threshold, metricLabel) {
  const chunks = [];
  const warnings = [];
  let startPage = 1;
  let runningTotal = 0;

  for (let index = 0; index < pageMetrics.length; index += 1) {
    const pageNumber = index + 1;
    const metric = pageMetrics[index];
    const wouldOverflow = runningTotal > 0 && runningTotal + metric > threshold;

    if (wouldOverflow) {
      chunks.push({
        startPage,
        endPage: pageNumber - 1,
        [`planned${metricLabel}`]: runningTotal,
      });
      startPage = pageNumber;
      runningTotal = 0;
    }

    if (metric > threshold) {
      warnings.push(
        `Page ${pageNumber} exceeds the requested ${metricLabel.toLowerCase()} limit by itself.`,
      );
    }

    runningTotal += metric;
  }

  if (pageMetrics.length > 0) {
    chunks.push({
      startPage,
      endPage: pageMetrics.length,
      [`planned${metricLabel}`]: runningTotal,
    });
  }

  return { chunks, warnings };
}

export function buildPageRange(startPage, endPage) {
  const indices = [];
  for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
    indices.push(pageNumber - 1);
  }
  return indices;
}

export function partitionIntoBatches(items, batchCount) {
  const batches = Array.from({ length: batchCount }, () => []);
  items.forEach((item, index) => {
    batches[index % batchCount].push(item);
  });
  return batches.filter((batch) => batch.length > 0);
}
