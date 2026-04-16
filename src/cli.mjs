#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import {
  prepareChunkJob,
  runPreparedChunkJob,
} from "./core.mjs";
import {
  detectDefaultJobs,
  formatBytes,
  parsePositiveInteger,
  parseSize,
} from "./shared.mjs";

function printHelp() {
  console.log(`pdf-chunker

Usage:
  pdf-chunker split <input.pdf> --mode pages --pages-per-chunk 25
  pdf-chunker split <input.pdf> --mode bytes --max-size 25MB
  pdf-chunker split <input.pdf> --mode chars --max-chars 120000

Options:
  --mode <pages|bytes|chars>   Chunking mode.
  --pages-per-chunk <number>   Required for pages mode.
  --max-size <size>            Required for bytes mode. Examples: 25MB, 512KiB.
  --max-chars <number>         Required for chars mode.
  --output, -o <dir>           Output directory. Default: <input>_chunks.
  --prefix <name>              File name prefix. Default: input file stem.
  --jobs, -j <number>          Worker count. Default: available CPU cores.
  --overwrite                  Allow overwriting existing output files.
  --dry-run                    Print the chunk plan without writing files.
  --validate                   Re-open every chunk after writing and verify page counts.
  --help, -h                   Show this help.
`);
}

function normalizeInvocation(positionals) {
  if (positionals.length === 0) {
    throw new Error("An input PDF is required.");
  }

  if (positionals[0] === "split") {
    if (!positionals[1]) {
      throw new Error("An input PDF is required after the split command.");
    }

    return positionals[1];
  }

  return positionals[0];
}

function parseCliArguments(argv) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      mode: { type: "string" },
      "pages-per-chunk": { type: "string" },
      "max-size": { type: "string" },
      "max-chars": { type: "string" },
      output: { type: "string", short: "o" },
      prefix: { type: "string" },
      jobs: { type: "string", short: "j" },
      overwrite: { type: "boolean" },
      "dry-run": { type: "boolean" },
      validate: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    args: argv,
  });

  if (values.help) {
    return { help: true };
  }

  const inputPath = path.resolve(normalizeInvocation(positionals));
  const mode = values.mode;
  if (!mode || !["pages", "bytes", "chars"].includes(mode)) {
    throw new Error("--mode must be one of: pages, bytes, chars.");
  }

  const jobs = values.jobs ? parsePositiveInteger(values.jobs, "jobs") : detectDefaultJobs();
  const args = {
    inputPath,
    mode,
    outputDir: values.output,
    prefix: values.prefix,
    jobs,
    overwrite: Boolean(values.overwrite),
    dryRun: Boolean(values["dry-run"]),
    validate: Boolean(values.validate),
  };

  if (mode === "pages") {
    if (!values["pages-per-chunk"]) {
      throw new Error("--pages-per-chunk is required in pages mode.");
    }
    args.pagesPerChunk = parsePositiveInteger(values["pages-per-chunk"], "pages-per-chunk");
  }

  if (mode === "bytes") {
    if (!values["max-size"]) {
      throw new Error("--max-size is required in bytes mode.");
    }
    args.maxBytes = parseSize(values["max-size"]);
  }

  if (mode === "chars") {
    if (!values["max-chars"]) {
      throw new Error("--max-chars is required in chars mode.");
    }
    args.maxChars = parsePositiveInteger(values["max-chars"], "max-chars");
  }

  return args;
}

function printPlan(plan, warnings) {
  console.log(`Planned ${plan.length} chunk(s).`);
  for (const chunk of plan) {
    const details = [];
    if (chunk.plannedBytes) {
      details.push(`planned ${formatBytes(chunk.plannedBytes)}`);
    }
    if (chunk.plannedChars) {
      details.push(`planned ${chunk.plannedChars.toLocaleString()} chars`);
    }

    const suffix = details.length > 0 ? ` (${details.join(", ")})` : "";
    console.log(
      `  ${String(chunk.index + 1).padStart(4, "0")}  pages ${chunk.startPage}-${chunk.endPage}${suffix}`,
    );
  }

  if (warnings.length > 0) {
    console.log("");
    for (const warning of warnings) {
      console.warn(`Warning: ${warning}`);
    }
  }
}

function printResults(results, outputDir) {
  console.log("");
  console.log(`Wrote ${results.length} chunk(s) to ${outputDir}`);
  for (const result of results) {
    console.log(
      `  ${result.fileName}  pages ${result.startPage}-${result.endPage}  ${formatBytes(result.bytes)}`,
    );
  }
}

async function main() {
  const args = parseCliArguments(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const prepared = await prepareChunkJob(args);
  printPlan(prepared.tasks, prepared.warnings);

  if (args.dryRun) {
    return;
  }

  const completed = await runPreparedChunkJob(prepared, args);
  printResults(completed.results, completed.outputDir);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
