import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, MessageChannelMain, session } from "electron";
import { ResourceProcess } from "../../../packages/resource/src/node/resource-process";
import { attachResourcePort } from "./resourceBroker";

const renderer = join(__dirname, "renderer.html");
const url = pathToFileURL(renderer).href;
let host: ResourceProcess;
let window: BrowserWindow;
let detach: (() => Promise<void>) | undefined;
let finishing = false;
let first: Record<string, unknown> | undefined;
let recovery: Record<string, unknown> | undefined;
let detaching = Promise.resolve();
const pids: number[] = [];
const cloneObservations: boolean[] = [];
let timer: NodeJS.Timeout;
const reportPath = process.env.RESOURCE_PROOF_REPORT;
async function finish(report: Record<string, unknown>, code: number): Promise<void> {
  if (finishing) return;
  finishing = true;
  clearTimeout(timer);
  await detach?.();
  await host?.stop();
  const complete = {
    build: JSON.parse(readFileSync(join(__dirname, "build-manifest.json"), "utf8")) as unknown,
    ...report,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    pid: host?.pid,
    pids,
    cloneObservations,
    diagnostics: host?.diagnostics(),
  };
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(complete, null, 2)}\n`);
  process.stdout.write(`RESOURCE_PROOF ${JSON.stringify(complete)}\n`);
  app.exit(code);
}
process.on("uncaughtException", (error) => {
  void finish({ ok: false, error: error.message }, 1);
});
process.on("unhandledRejection", (error) => {
  void finish({ ok: false, error: String(error) }, 1);
});
app.enableSandbox();
void app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  host = new ResourceProcess({
    executablePath: join(
      __dirname,
      "bin",
      process.platform === "win32" ? "electron-rust-resource.exe" : "electron-rust-resource",
    ),
    authorize: (_client, key) => key === "fixture",
  });
  await host.start();
  if (host.pid !== undefined) pids.push(host.pid);
  window = new BrowserWindow({
    show: false,
    width: 900,
    height: 650,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("preload-error", (_event, _path, error) => {
    void finish({ ok: false, error: error.message }, 1);
  });
  window.webContents.on("render-process-gone", () => {
    void finish({ ok: false, error: "renderer crashed" }, 1);
  });
  window.webContents.on("did-start-loading", () => {
    const old = detach;
    detach = undefined;
    detaching = old === undefined ? Promise.resolve() : old();
    void detaching.then(() => host.pauseBulk(false));
  });
  window.webContents.on("did-finish-load", () => {
    void (async () => {
      await detaching;
      const channel = new MessageChannelMain();
      detach = await attachResourcePort(host, channel.port1, (retained) =>
        cloneObservations.push(retained),
      );
      window.webContents.mainFrame.postMessage("resource:port", null, [channel.port2]);
    })();
  });
  ipcMain.handle("resource:checkpoint", async (event, value: unknown) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== url
    )
      throw new Error("invalid checkpoint sender");
    const m = value as Record<string, unknown>;
    if (m.kind === "failure") {
      await finish({ ok: false, ...m }, 1);
      return;
    }
    if (m.kind === "pauseBulk") {
      host.pauseBulk(true);
      return;
    }
    if (m.kind === "reload") {
      first = m;
      const deadline = performance.now() + 2000;
      while (host.diagnostics().inFlight.items < 2 && performance.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 5));
      if (host.diagnostics().inFlight.items !== 2)
        throw new Error("reload did not interrupt two real reads");
      first.nativeBeforeReload = await host.command("resource.metrics", {});
      first.inFlightAtReload = host.diagnostics().inFlight;
      setImmediate(() => window.webContents.reload());
      return;
    }
    if (m.kind === "crash") {
      host.terminate();
      await host.stop();
      return;
    }
    if (m.kind === "restart") {
      if (m.oldEpoch !== first?.epoch) throw new Error("reload changed original authority epoch");
      recovery = m;
      await detach?.();
      detach = undefined;
      host = new ResourceProcess({
        executablePath: join(
          __dirname,
          "bin",
          process.platform === "win32" ? "electron-rust-resource.exe" : "electron-rust-resource",
        ),
        authorize: (_client, key) => key === "fixture",
      });
      await host.start();
      if (host.authorityEpoch.toString() === m.oldEpoch)
        throw new Error("replacement authority reused epoch");
      if (host.pid !== undefined) pids.push(host.pid);
      setImmediate(() => window.webContents.reload());
      return;
    }
    if (m.kind === "revoke") {
      await host.command("fixture.revoke", {}, true);
      return;
    }
    if (m.kind === "complete") {
      if (first?.epoch === m.reloadEpoch || recovery === undefined)
        throw new Error("authority recovery not proven");
      const metrics = await host.command("resource.metrics", {});
      const screenshot = await window.webContents.capturePage();
      if (reportPath) writeFileSync(reportPath.replace(/\.json$/, ".png"), screenshot.toPNG());
      await finish({ ok: true, initial: first, recovery, reloaded: m, native: metrics }, 0);
      return;
    }
    throw new Error("unknown proof checkpoint");
  });
  timer = setTimeout(() => {
    void finish({ ok: false, error: "Electron resource proof deadline" }, 1);
  }, 45000);
  await window.loadFile(renderer);
});
