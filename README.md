# pdf-chunker

`pdf-chunker` is a cross-platform desktop app and CLI for breaking large PDFs into smaller files by:

- fixed page count
- target output file size
- extracted text character count

The desktop GUI and the CLI both use the same worker-thread chunking engine, so large jobs still fan out across your machine's available CPU cores.

## Requirements

- Node.js 20+

## Run The Desktop App

```bash
git clone https://github.com/AllThereIsToBe/pdfchunker.git
cd pdfchunker
npm install
npm start
```

The GUI gives you:

- native PDF picker and output-folder picker
- page, byte, and text-size chunk modes
- worker-count, overwrite, and validation controls
- plan preview before writing files
- live chunk progress while files are being written
- open-output-folder action after a run

## Package The App

Build an unpacked desktop bundle:

```bash
npm run dist:dir
```

Build installer artifacts for the current platform:

```bash
npm run dist
```

## Automation

- GitHub Actions builds the app on macOS, Windows, and Linux for pushes to `main`, pull requests, and manual runs.
- Tagged releases using `v*` build and publish release artifacts through `electron-builder`.
- A lockfile sync workflow writes `package-lock.json` back to the repo automatically when it is missing.

## CLI Usage

You can still run it directly from the terminal:

```bash
node ./src/cli.mjs split /path/to/file.pdf --mode pages --pages-per-chunk 25
```

Or link the CLI globally from the project folder:

```bash
npm link
pdf-chunker split /path/to/file.pdf --mode bytes --max-size 25MB
```

## Examples

Split every 20 pages:

```bash
pdf-chunker split ./big.pdf --mode pages --pages-per-chunk 20
```

Keep each output PDF under 15 MB when possible:

```bash
pdf-chunker split ./big.pdf --mode bytes --max-size 15MB
```

Chunk by extracted text size:

```bash
pdf-chunker split ./big.pdf --mode chars --max-chars 120000
```

Write into a custom directory with 8 workers:

```bash
pdf-chunker split ./big.pdf --mode pages --pages-per-chunk 50 --output ./chunks --jobs 8
```

Dry-run a chunking plan without writing files:

```bash
pdf-chunker split ./big.pdf --mode bytes --max-size 50MB --dry-run
```

Validate each output chunk after it is written:

```bash
pdf-chunker split ./big.pdf --mode pages --pages-per-chunk 30 --validate
```

## Notes

- `pages` mode is the fastest mode.
- `bytes` mode measures real generated chunk sizes while planning, so the limit is based on actual output files rather than a rough estimate.
- `chars` mode relies on embedded PDF text. Image-only or scanned PDFs without OCR will usually report very low text counts.
- If a single page is larger than the requested byte limit, the tool still emits that page as its own chunk and reports a warning.
- The packaged GUI is Electron-based. Current packaging config targets macOS, Windows, and Linux from the same project.

## Output naming

Files are written to `<input-name>_chunks` by default with names like:

```text
report.part-0001.p0001-0025.pdf
report.part-0002.p0026-0050.pdf
```