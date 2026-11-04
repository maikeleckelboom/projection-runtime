import { contextBridge, ipcRenderer } from "electron";

let attached = false;
ipcRenderer.on("resource:port", (event) => {
  if (attached || event.ports.length !== 1) {
    for (const port of event.ports) port.close();
    return;
  }
  attached = true;
  // Only the dedicated resource port crosses worlds. No generic Electron API.
  window.postMessage({ kind: "resourcePort", version: 1 }, "*", [event.ports[0] as MessagePort]);
});
contextBridge.exposeInMainWorld("resourceProof", {
  checkpoint: (value: unknown) => ipcRenderer.invoke("resource:checkpoint", value),
});
