const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bigcoachApp", {
  getState: () => ipcRenderer.invoke("app:get-state"),
  openReviewUrl: (url) => ipcRenderer.invoke("bigcoach:open-url", url),
  getReviewHistory: () => ipcRenderer.invoke("bigcoach:history"),
  refreshScene: () => ipcRenderer.invoke("bigcoach:scene"),
  runSimulation: () => ipcRenderer.invoke("simulator:run"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  previewCard: (payload) => ipcRenderer.invoke("anki:preview", payload),
  registerCard: (payload) => ipcRenderer.invoke("anki:register", payload),
  setPanelWidth: (width) => ipcRenderer.send("layout:panel-width", width),
  setOverlayOpen: (open) => ipcRenderer.invoke("layout:overlay-open", open),
  onBigCoachStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("bigcoach:status", listener);
    return () => ipcRenderer.removeListener("bigcoach:status", listener);
  }
});
