import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, MessageChannelMain, session, type WebContents } from "electron";
import { AuthorityHost, type AuthorityStopReport, CLIENT_PORT_CHANNEL } from "./authorityHost.js";
import type { AutomatedProofReport } from "./proofAudit.js";

const RESULT_PREFIX = "EXCLAVE_ELECTRON_RUST_WARM_RESULT ";
const AUTHORITY_PID_PREFIX = "EXCLAVE_ELECTRON_RUST_WARM_AUTHORITY_PID ";
const integrationTestMode = process.env.EXCLAVE_ELECTRON_RUST_WARM_E2E === "1";
const rendererPath = join(__dirname, "renderer.html");
const rendererUrl = pathToFileURL(rendererPath).href;
const preloadPath = join(__dirname, "preload.cjs");
const authorityExecutablePath = join(
  __dirname,
  "bin",
  process.platform === "win32"
    ? "electron-rust-warm-authority.exe"
    : "electron-rust-warm-authority",
);

let detachRendererPort: (() => void) | null = null;
let host: AuthorityHost | null = null;
let finalizationStarted = false;
let allowImmediateExit = false;
let e2eTimeout: NodeJS.Timeout | null = null;

app.enableSandbox();
app.setName("Projection Runtime warm authority proof");

app.on("web-contents-created", (_event, contents) => hardenWebContents(contents));
app.on("window-all-closed", () => {
  if (finalizationStarted) return;
  if (integrationTestMode) {
    void finishWithoutProof("window closed before proof completion");
  } else {
    app.quit();
  }
});
app.on("before-quit", (event) => {
  detachRendererPort?.();
  detachRendererPort = null;
  if (allowImmediateExit) return;
  event.preventDefault();
  if (finalizationStarted) return;
  if (integrationTestMode) {
    void finishWithoutProof("app quit before proof completion");
  } else {
    void finishOrdinaryQuit();
  }
});

process.on("uncaughtException", (error) => {
  void finishWithoutProof(`uncaught exception: ${error.message}`);
});
process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  void finishWithoutProof(`unhandled rejection: ${message}`);
});

void app.whenReady().then(() => {
  configureSessionSecurity();
  host = new AuthorityHost({
    authorityExecutablePath,
    ...(integrationTestMode
      ? {
          integrationTestEpochs: ["101", "202"],
          integrationReadyDelayMs: 1_500,
          restartDelayMs: 250,
          downstreamProofWindowMs: 180,
          onProofComplete: (report: AutomatedProofReport) => {
            setTimeout(() => void finishSuccessfulProof(report), 150);
          },
          onProofFailure: (message: string) => {
            setTimeout(() => void finishWithoutProof(`automated proof failed: ${message}`), 50);
          },
          onAuthorityProcessSpawned: (pid: number) => {
            process.stdout.write(`${AUTHORITY_PID_PREFIX}${pid}\n`);
          },
        }
      : {}),
  });
  host.start();
  createWindow();

  if (integrationTestMode) {
    e2eTimeout = setTimeout(() => {
      void finishWithoutProof("automated Electron proof timed out");
    }, 45_000);
  }
});

function createWindow(): void {
  const createdWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 760,
    minHeight: 620,
    show: !integrationTestMode,
    backgroundColor: "#0d1117",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !integrationTestMode,
      backgroundThrottling: false,
    },
  });
  createdWindow.webContents.on("did-start-loading", () => {
    detachRendererPort?.();
    detachRendererPort = null;
  });
  createdWindow.webContents.on("did-finish-load", () => {
    const activeHost = host;
    if (activeHost === null || createdWindow.isDestroyed()) return;
    const channel = new MessageChannelMain();
    detachRendererPort = activeHost.attachRendererPort(channel.port1);
    createdWindow.webContents.postMessage(CLIENT_PORT_CHANNEL, null, [channel.port2]);
  });
  createdWindow.webContents.on("render-process-gone", (_event, details) => {
    void finishWithoutProof(`renderer process exited: ${details.reason}`);
  });
  createdWindow.webContents.on("preload-error", (_event, _preloadPath, error) => {
    if (integrationTestMode) process.stderr.write(`[preload-error] ${error.message}\n`);
  });
  createdWindow.webContents.on("did-fail-load", (_event, code, description) => {
    void finishWithoutProof(`renderer load failed (${code}): ${description}`);
  });
  createdWindow.webContents.on("console-message", (details) => {
    if (integrationTestMode) {
      process.stderr.write(`[renderer:${details.level}] ${details.message}\n`);
    }
  });
  createdWindow.on("closed", () => {
    detachRendererPort?.();
    detachRendererPort = null;
  });

  void createdWindow.loadFile(rendererPath).catch((error: unknown) => {
    void finishWithoutProof(`renderer load failed: ${errorMessage(error)}`);
  });
}

function hardenWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on("will-navigate", (event, navigationUrl) => {
    let normalizedNavigationUrl: string | null = null;
    try {
      const target = new URL(navigationUrl);
      target.hash = "";
      target.search = "";
      normalizedNavigationUrl = target.href;
    } catch {
      normalizedNavigationUrl = null;
    }
    if (normalizedNavigationUrl !== rendererUrl) event.preventDefault();
  });
}

function configureSessionSecurity(): void {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      cancel: false,
      responseHeaders: {
        ...details.responseHeaders,
        "Cross-Origin-Opener-Policy": ["same-origin"],
        "Cross-Origin-Resource-Policy": ["same-origin"],
        "X-Content-Type-Options": ["nosniff"],
      },
    });
  });
}

async function finishSuccessfulProof(report: AutomatedProofReport): Promise<void> {
  if (finalizationStarted) return;
  finalizationStarted = true;
  clearE2eTimeout();
  const stop = await stopHost();
  const cleanExit = stop.exitWasExpected && stop.exitCode === 0;
  writeResult({
    ...report,
    shutdown: {
      authorityProcessStopped: stop.processStopped,
      cleanExit,
      exitCode: stop.exitCode,
    },
  });
  exitApp(cleanExit ? 0 : 1);
}

async function finishWithoutProof(message: string): Promise<void> {
  if (finalizationStarted) return;
  finalizationStarted = true;
  clearE2eTimeout();
  const stop = await stopHost();
  if (integrationTestMode) {
    writeResult({
      ok: false,
      error: message,
      shutdown: {
        authorityProcessStopped: stop.processStopped,
        cleanExit: stop.exitWasExpected && stop.exitCode === 0,
        exitCode: stop.exitCode,
      },
    });
  } else {
    process.stderr.write(`${message}\n`);
  }
  exitApp(1);
}

async function finishOrdinaryQuit(): Promise<void> {
  if (finalizationStarted) return;
  finalizationStarted = true;
  clearE2eTimeout();
  const stop = await stopHost();
  exitApp(stop.processStopped ? 0 : 1);
}

async function stopHost(): Promise<AuthorityStopReport> {
  detachRendererPort?.();
  detachRendererPort = null;
  const activeHost = host;
  host = null;
  if (activeHost === null) {
    return { processStopped: true, exitCode: null, exitWasExpected: true };
  }
  return activeHost.stop();
}

function clearE2eTimeout(): void {
  if (e2eTimeout !== null) {
    clearTimeout(e2eTimeout);
    e2eTimeout = null;
  }
}

function writeResult(value: unknown): void {
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(value)}\n`);
}

function exitApp(exitCode: number): void {
  allowImmediateExit = true;
  app.exit(exitCode);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
