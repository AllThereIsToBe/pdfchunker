const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pdfChunker", {
  getDefaults: () => ipcRenderer.invoke("app:getDefaults"),
  pickPdf: () => ipcRenderer.invoke("dialog:pickPdf"),
  pickOutputDir: () => ipcRenderer.invoke("dialog:pickOutputDir"),
  plan: (options) => ipcRenderer.invoke("chunker:plan", options),
  run: (options) => ipcRenderer.invoke("chunker:run", options),
  openPath: (targetPath) => ipcRenderer.invoke("shell:openPath", targetPath),
  onProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("chunker:progress", handler);
    return () => ipcRenderer.removeListener("chunker:progress", handler);
  },
});
