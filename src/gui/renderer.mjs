const state = {
  running: false,
  currentOutputDir: "",
  latestPlan: null,
  latestResultMap: new Map(),
};

const elements = {
  form: document.querySelector("#job-form"),
  inputPath: document.querySelector("#input-path"),
  outputPath: document.querySelector("#output-path"),
  prefix: document.querySelector("#prefix"),
  jobs: document.querySelector("#jobs"),
  pagesPerChunk: document.querySelector("#pages-per-chunk"),
  maxSize: document.querySelector("#max-size"),
  maxChars: document.querySelector("#max-chars"),
  overwrite: document.querySelector("#overwrite"),
  validate: document.querySelector("#validate"),
  pickInput: document.querySelector("#pick-input"),
  pickOutput: document.querySelector("#pick-output"),
  clearInput: document.querySelector("#clear-input"),
  dropZone: document.querySelector("#drop-zone"),
  planButton: document.querySelector("#plan-button"),
  runButton: document.querySelector("#run-button"),
  openOutput: document.querySelector("#open-output"),
  modeOptions: Array.from(document.querySelectorAll('input[name="mode"]')),
  modeFields: Array.from(document.querySelectorAll(".mode-field")),
  statusTitle: document.querySelector("#status-title"),
  statusMessage: document.querySelector("#status-message"),
  statusPill: document.querySelector("#status-pill"),
  progressBar: document.querySelector("#progress-bar"),
  progressLabel: document.querySelector("#progress-label"),
  warningsPanel: document.querySelector("#warnings-panel"),
  summaryCards: document.querySelector("#summary-cards"),
  chunkTableBody: document.querySelector("#chunk-table-body"),
  metricWorkers: document.querySelector("#metric-workers"),
  metricLastRun: document.querySelector("#metric-last-run"),
  platformBadge: document.querySelector("#platform-badge"),
};

function activeMode() {
  return elements.modeOptions.find((option) => option.checked)?.value ?? "pages";
}

function setBusy(isBusy) {
  state.running = isBusy;
  elements.planButton.disabled = isBusy;
  elements.runButton.disabled = isBusy;
  elements.pickInput.disabled = isBusy;
  elements.pickOutput.disabled = isBusy;
}

function setStatus(kind, title, message, progress = null) {
  elements.statusTitle.textContent = title;
  elements.statusMessage.textContent = message;
  elements.statusPill.className = `status-pill ${kind}`;
  elements.statusPill.textContent = kind === "working"
    ? "Working"
    : kind === "success"
      ? "Complete"
      : kind === "error"
        ? "Error"
        : "Idle";

  if (typeof progress === "number") {
    elements.progressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  }
}

function updateModeFields() {
  const mode = activeMode();
  for (const field of elements.modeFields) {
    field.classList.toggle("hidden", field.dataset.mode !== mode);
  }
}

function updateOpenOutputState() {
  elements.openOutput.disabled = !state.currentOutputDir;
}

function collectOptions() {
  const options = {
    inputPath: elements.inputPath.value.trim(),
    outputDir: elements.outputPath.value.trim() || undefined,
    prefix: elements.prefix.value.trim() || undefined,
    jobs: elements.jobs.value.trim() || undefined,
    mode: activeMode(),
    overwrite: elements.overwrite.checked,
    validate: elements.validate.checked,
  };

  if (!options.inputPath) {
    throw new Error("Choose a PDF file first.");
  }

  if (options.mode === "pages") {
    options.pagesPerChunk = elements.pagesPerChunk.value.trim();
  }

  if (options.mode === "bytes") {
    options.maxSize = elements.maxSize.value.trim();
  }

  if (options.mode === "chars") {
    options.maxChars = elements.maxChars.value.trim();
  }

  return options;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function shortPath(filePath) {
  if (!filePath) {
    return "-";
  }

  const parts = filePath.split(/[\\/]/);
  if (parts.length <= 3) {
    return filePath;
  }

  return `.../${parts.slice(-3).join("/")}`;
}

function renderWarnings(warnings) {
  if (!warnings || warnings.length === 0) {
    elements.warningsPanel.classList.add("hidden");
    elements.warningsPanel.innerHTML = "";
    return;
  }

  elements.warningsPanel.classList.remove("hidden");
  elements.warningsPanel.innerHTML = `
    <strong>Warnings</strong>
    <ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>
  `;
}

function renderSummary(plan) {
  state.latestPlan = plan;
  state.currentOutputDir = plan.outputDir;
  updateOpenOutputState();
  renderWarnings(plan.warnings);

  const thirdCardLabel = plan.mode === "bytes" ? "Planned Total" : "Output";
  const thirdCardValue = plan.mode === "bytes"
    ? plan.totals.plannedBytesLabel ?? "-"
    : shortPath(plan.outputDir);

  elements.summaryCards.classList.remove("empty");
  elements.summaryCards.innerHTML = `
    <article class="summary-card">
      <span class="summary-label">Pages</span>
      <strong>${formatNumber(plan.pageCount)}</strong>
    </article>
    <article class="summary-card">
      <span class="summary-label">Chunks</span>
      <strong>${formatNumber(plan.chunkCount)}</strong>
    </article>
    <article class="summary-card">
      <span class="summary-label">${thirdCardLabel}</span>
      <strong class="${plan.mode === "bytes" ? "" : "mono"}">${escapeHtml(thirdCardValue)}</strong>
    </article>
  `;

  renderTable(plan.chunks, state.latestResultMap);
}

function renderTable(chunks, resultMap) {
  if (!chunks || chunks.length === 0) {
    elements.chunkTableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="6">No plan yet.</td>
      </tr>
    `;
    return;
  }

  elements.chunkTableBody.innerHTML = chunks
    .map((chunk) => {
      const actual = resultMap.get(chunk.index);
      const planned = chunk.plannedBytesLabel
        ?? (typeof chunk.plannedChars === "number"
          ? `${formatNumber(chunk.plannedChars)} chars`
          : "-");

      return `
        <tr>
          <td>${String(chunk.index + 1).padStart(4, "0")}</td>
          <td>${chunk.startPage}-${chunk.endPage}</td>
          <td>${formatNumber(chunk.pageCount)}</td>
          <td>${planned}</td>
          <td>${actual?.bytesLabel ?? "-"}</td>
          <td class="mono">${escapeHtml(chunk.fileName)}</td>
        </tr>
      `;
    })
    .join("");
}

function resetResults() {
  state.latestResultMap = new Map();
  if (state.latestPlan) {
    renderTable(state.latestPlan.chunks, state.latestResultMap);
  }
}

async function pickPdf() {
  const pickedPath = await window.pdfChunker.pickPdf();
  if (pickedPath) {
    elements.inputPath.value = pickedPath;
  }
}

async function pickOutputDir() {
  const pickedPath = await window.pdfChunker.pickOutputDir();
  if (pickedPath) {
    elements.outputPath.value = pickedPath;
  }
}

async function planJob() {
  const options = collectOptions();
  setBusy(true);
  resetResults();
  setStatus("working", "Planning", "Scanning the PDF and building a chunk plan.", 8);
  elements.progressLabel.textContent = "Building chunk preview.";

  try {
    const plan = await window.pdfChunker.plan(options);
    renderSummary(plan);
    setStatus(
      "idle",
      "Plan Ready",
      `${plan.chunkCount} chunk${plan.chunkCount === 1 ? "" : "s"} planned from ${plan.pageCount} page${plan.pageCount === 1 ? "" : "s"}.`,
      0,
    );
    elements.progressLabel.textContent = `${plan.chunkCount} chunk preview ready.`;
  } finally {
    setBusy(false);
  }
}

async function runJob() {
  const options = collectOptions();
  setBusy(true);
  resetResults();
  elements.metricLastRun.textContent = "Running";
  setStatus("working", "Running", "Writing chunks to disk.", 0);
  elements.progressLabel.textContent = "Starting workers.";

  try {
    const result = await window.pdfChunker.run(options);
    renderSummary(result);
    state.latestResultMap = new Map(result.results.map((entry) => [entry.index, entry]));
    renderTable(result.chunks, state.latestResultMap);
    setStatus(
      "success",
      "Run Complete",
      `Wrote ${result.results.length} chunk${result.results.length === 1 ? "" : "s"} to ${result.outputDir}.`,
      100,
    );
    elements.progressLabel.textContent = `${result.totals.writtenBytesLabel} written across ${result.results.length} files.`;
    elements.metricLastRun.textContent = `${result.results.length} chunks`;
  } finally {
    setBusy(false);
  }
}

function handleError(error) {
  const message = error instanceof Error ? error.message : String(error);
  setStatus("error", "Run Failed", message, 0);
  elements.progressLabel.textContent = "No output written.";
  elements.metricLastRun.textContent = "Failed";
  setBusy(false);
}

function bindDragAndDrop() {
  const zone = elements.dropZone;

  const clearHover = () => zone.classList.remove("dragover");

  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("dragover");
  });

  zone.addEventListener("dragleave", clearHover);
  zone.addEventListener("dragend", clearHover);

  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    clearHover();

    const file = event.dataTransfer?.files?.[0];
    const droppedPath = file?.path;
    if (droppedPath && droppedPath.toLowerCase().endsWith(".pdf")) {
      elements.inputPath.value = droppedPath;
    }
  });
}

async function init() {
  updateModeFields();
  bindDragAndDrop();
  updateOpenOutputState();

  const defaults = await window.pdfChunker.getDefaults();
  elements.jobs.value = String(defaults.jobs);
  elements.metricWorkers.textContent = String(defaults.jobs);
  elements.platformBadge.textContent = defaults.platform;

  elements.modeOptions.forEach((option) => {
    option.addEventListener("change", updateModeFields);
  });

  elements.pickInput.addEventListener("click", () => {
    pickPdf().catch(handleError);
  });

  elements.pickOutput.addEventListener("click", () => {
    pickOutputDir().catch(handleError);
  });

  elements.clearInput.addEventListener("click", () => {
    elements.inputPath.value = "";
  });

  elements.planButton.addEventListener("click", () => {
    planJob().catch(handleError);
  });

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    runJob().catch(handleError);
  });

  elements.openOutput.addEventListener("click", () => {
    if (state.currentOutputDir) {
      window.pdfChunker.openPath(state.currentOutputDir).catch(handleError);
    }
  });

  window.pdfChunker.onProgress((payload) => {
    if (payload.phase === "starting") {
      if (payload.plan) {
        renderSummary(payload.plan);
        resetResults();
      }
      setStatus("working", "Starting", "Preparing output files and launching workers.", 3);
      elements.progressLabel.textContent = `0 of ${payload.totalTasks} chunks written.`;
      return;
    }

    if (payload.phase === "writing") {
      if (payload.result) {
        state.latestResultMap.set(payload.result.index, payload.result);
      }
      if (state.latestPlan) {
        renderTable(state.latestPlan.chunks, state.latestResultMap);
      }
      setStatus(
        "working",
        "Writing",
        `Chunk ${payload.completedCount} of ${payload.totalTasks} finished.`,
        payload.percent,
      );
      elements.progressLabel.textContent = `${payload.completedCount} of ${payload.totalTasks} chunks written.`;
    }
  });
}

init().catch(handleError);
