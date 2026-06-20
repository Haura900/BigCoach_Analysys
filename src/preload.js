const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bigcoachApp", {
  getState: () => ipcRenderer.invoke("app:get-state"),
  navigate: (direction) => ipcRenderer.invoke("bigcoach:navigate", direction),
  listMajorMistakes: () => ipcRenderer.invoke("bigcoach:major-mistakes"),
  goToMajorMistake: (mismatchOrdinal) => ipcRenderer.invoke("bigcoach:go-to-mistake", mismatchOrdinal),
  refreshScene: () => ipcRenderer.invoke("bigcoach:scene"),
  runSimulation: () => ipcRenderer.invoke("simulator:run"),
  diagnose: () => ipcRenderer.invoke("app:diagnose"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  previewCard: (memo) => ipcRenderer.invoke("anki:preview", memo),
  registerCard: (payload) => ipcRenderer.invoke("anki:register", payload),
  reloadBigCoach: () => ipcRenderer.invoke("bigcoach:reload"),
  openLogs: () => ipcRenderer.invoke("app:open-logs"),
  setPanelWidth: (width) => ipcRenderer.send("layout:panel-width", width),
  onBigCoachStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("bigcoach:status", listener);
    return () => ipcRenderer.removeListener("bigcoach:status", listener);
  }
});
