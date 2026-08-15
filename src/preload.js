const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bigcoachApp", {
  getState: () => ipcRenderer.invoke("app:get-state"),
  openReviewUrl: (url) => ipcRenderer.invoke("bigcoach:open-url", url),
  getReviewHistory: () => ipcRenderer.invoke("bigcoach:history"),
  refreshScene: () => ipcRenderer.invoke("bigcoach:scene"),
  stockFirstDiscards: () => ipcRenderer.invoke("bigcoach:stock-first-discards"),
  calculateHandScore: () => ipcRenderer.invoke("bigcoach:hand-score"),
  runSimulation: () => ipcRenderer.invoke("simulator:run"),
  runEvAnalysis: (thresholdPercent) => ipcRenderer.invoke("analysis:ev-run", thresholdPercent),
  jumpToEvAnalysis: (index) => ipcRenderer.invoke("analysis:ev-jump", index),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  captureCardPreview: (payload) => ipcRenderer.invoke("anki:capture-preview", payload),
  finishCardPreview: (payload) => ipcRenderer.invoke("anki:finish-preview", payload),
  registerCard: (payload) => ipcRenderer.invoke("anki:register", payload),
  setPanelWidth: (width) => ipcRenderer.send("layout:panel-width", width),
  setOverlayOpen: (open) => ipcRenderer.invoke("layout:overlay-open", open),
  onBigCoachStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("bigcoach:status", listener);
    return () => ipcRenderer.removeListener("bigcoach:status", listener);
  }
});
