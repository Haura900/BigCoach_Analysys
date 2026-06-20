const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bigcoachApp", {
  getState: () => ipcRenderer.invoke("app:get-state"),
  navigate: (direction) => ipcRenderer.invoke("bigcoach:navigate", direction),
  listMajorMistakes: () => ipcRenderer.invoke("bigcoach:major-mistakes"),
  goToMajorMistake: (mismatchOrdinal) => ipcRenderer.invoke("bigcoach:go-to-mistake", mismatchOrdinal),
  openReviewUrl: (url) => ipcRenderer.invoke("bigcoach:open-url", url),
  getReviewHistory: () => ipcRenderer.invoke("bigcoach:history"),
  refreshScene: () => ipcRenderer.invoke("bigcoach:scene"),
  runSimulation: () => ipcRenderer.invoke("simulator:run"),
  diagnose: () => ipcRenderer.invoke("app:diagnose"),
  refreshStats: () => ipcRenderer.invoke("stats:refresh"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  previewCard: (memo) => ipcRenderer.invoke("anki:preview", memo),
  registerCard: (payload) => ipcRenderer.invoke("anki:register", payload),
  reloadBigCoach: () => ipcRenderer.invoke("bigcoach:reload"),
  openLogs: () => ipcRenderer.invoke("app:open-logs"),
  setPanelWidth: (width) => ipcRenderer.send("layout:panel-width", width),
  setOverlayOpen: (open) => ipcRenderer.send("layout:overlay-open", open),
  onBigCoachStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("bigcoach:status", listener);
    return () => ipcRenderer.removeListener("bigcoach:status", listener);
  },
  onStatsUpdated: (callback) => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on("stats:updated", listener);
    return () => ipcRenderer.removeListener("stats:updated", listener);
  }
});
