import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import * as readline from "readline";
import { promisify } from "util";

const execFileAsync = promisify(cp.execFile);

let pyProc: cp.ChildProcess | undefined;
let rl: readline.Interface | undefined;
let pendingResolve: ((msg: Record<string, unknown>) => void) | undefined;
let suppressPythonExitLog = false;
let stderrBuf = "";

const PYTHON_TIMEOUT_MS = 120_000;

function speechMicErrorHint(code: string | undefined): string {
  const c = (code ?? "").toLowerCase();
  if (c === "not-allowed" || c === "service-not-allowed") {
    if (process.platform === "darwin") {
      return (
        "Microphone blocked (not-allowed). On macOS: System Settings → Privacy & Security → Microphone → " +
        "turn ON for Visual Studio Code or Cursor. Then Developer: Reload Window and open Voice Ask again."
      );
    }
    if (process.platform === "win32") {
      return (
        "Microphone blocked (not-allowed). Windows: Settings → Privacy & security → Microphone → allow access, " +
        "and allow VS Code. Then reload the window and try again."
      );
    }
    return (
      "Microphone blocked (not-allowed). Allow the microphone for this app in your OS privacy settings, reload the window, and try again."
    );
  }
  return `Speech recognition: ${code ?? "unknown error"}`;
}

/** Trim secrets so pasted keys with newlines/spaces still work. */
function trimSecret(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function defaultPythonExecutable(): string {
  return process.platform === "win32" ? "python" : "python3";
}

function pythonExecutable(): string {
  const cfg = vscode.workspace.getConfiguration("codewhisper");
  const override = cfg.get<string>("pythonPath")?.trim();
  return override && override.length > 0 ? override : defaultPythonExecutable();
}

function backendDir(extPath: string): string {
  return path.join(extPath, "backend");
}

function pipInstallCommand(extPath: string): string {
  const req = path.join(backendDir(extPath), "requirements.txt");
  const py = pythonExecutable();
  return `${py} -m pip install --user -r "${req}"`;
}

async function runPipInstallDeps(extPath: string): Promise<void> {
  const py = pythonExecutable();
  const req = path.join(backendDir(extPath), "requirements.txt");
  await execFileAsync(py, ["-m", "pip", "install", "--user", "-r", req], {
    windowsHide: true,
  });
}

function disposePython(): void {
  suppressPythonExitLog = true;
  rl?.close();
  rl = undefined;
  pyProc?.removeAllListeners();
  pyProc?.kill();
  pyProc = undefined;
}

function spawnPython(extPath: string, output: vscode.OutputChannel): void {
  disposePython();
  suppressPythonExitLog = false;
  stderrBuf = "";
  const script = path.join(extPath, "backend", "main.py");
  const py = pythonExecutable();
  pyProc = cp.spawn(py, [script], { stdio: ["pipe", "pipe", "pipe"] });

  rl = readline.createInterface({ input: pyProc.stdout! });
  rl.on("line", (line) => {
    try {
      const msg = JSON.parse(line) as Record<string, unknown>;
      pendingResolve?.(msg);
      pendingResolve = undefined;
    } catch {
      // ignore malformed lines
    }
  });

  pyProc.stderr!.on("data", (d: Buffer) => {
    const s = d.toString();
    stderrBuf += s;
    output.appendLine(s.trimEnd());
  });

  pyProc.on("error", (err: NodeJS.ErrnoException) => {
    void vscode.window.showErrorMessage(
      `CodeWhisper: could not start Python (${py}). ${err.message}. Check Settings → CodeWhisper → Python Path.`
    );
  });

  pyProc.on("exit", (code, signal) => {
    if (suppressPythonExitLog) {
      suppressPythonExitLog = false;
      return;
    }
    const hint = stderrBuf.includes("ModuleNotFoundError")
      ? `Try: ${pipInstallCommand(extPath)}`
      : "";
    output.appendLine(
      `Python backend exited (${signal ?? `code ${code}`}). ${hint}`.trim()
    );
    pyProc = undefined;
    rl?.close();
    rl = undefined;
  });
}

function sendToPython(msg: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    if (!pyProc?.stdin?.writable) {
      resolve({ type: "error", message: "Python backend is not running." });
      return;
    }
    const timer = setTimeout(() => {
      pendingResolve = undefined;
      resolve({ type: "error", message: "Request timed out. Check network and API keys." });
    }, timeoutMs);
    pendingResolve = (response: Record<string, unknown>) => {
      clearTimeout(timer);
      resolve(response);
    };
    try {
      pyProc.stdin.write(JSON.stringify(msg) + "\n");
    } catch {
      clearTimeout(timer);
      pendingResolve = undefined;
      resolve({ type: "error", message: "Failed to write to Python backend." });
    }
  });
}

async function ensureBackendAlive(context: vscode.ExtensionContext, output: vscode.OutputChannel): Promise<boolean> {
  if (pyProc && !pyProc.killed) return true;
  spawnPython(context.extensionPath, output);
  await new Promise((r) => setTimeout(r, 150));
  if (!pyProc || pyProc.killed) return false;
  const pong = await sendToPython({ type: "ping" }, 8000);
  return pong.type === "pong";
}

async function offerInstallDeps(extPath: string): Promise<void> {
  const cmd = pipInstallCommand(extPath);
  const choice = await vscode.window.showWarningMessage(
    "CodeWhisper: Python package httpx (or backend) is missing.",
    "Install now",
    "Copy pip command"
  );
  if (choice === "Copy pip command") {
    await vscode.env.clipboard.writeText(cmd);
    void vscode.window.showInformationMessage("Copied pip command to clipboard.");
  } else if (choice === "Install now") {
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "CodeWhisper: installing Python dependencies…" },
        () => runPipInstallDeps(extPath)
      );
      void vscode.window.showInformationMessage("CodeWhisper: Python dependencies installed. Run Voice Ask again.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`CodeWhisper: pip install failed. ${msg}`);
    }
  }
}

function getEditorContext(): { code: string; filename: string } {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return { code: "", filename: "" };
  const selection = editor.selection;
  const code = selection.isEmpty
    ? editor.document.getText()
    : editor.document.getText(selection);
  const filename = editor.document.fileName;
  return { code, filename };
}

function getVoiceHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src blob: data: mediastream:;">
  <style>
    body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-foreground); display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; margin:0; gap:12px; padding:12px; box-sizing:border-box; }
    button { font-size:48px; background:none; border:none; cursor:pointer; }
    #status { font-size:13px; opacity:0.85; text-align:center; max-width:28rem; line-height:1.4; }
    audio { display:none; }
    .row { width:100%; max-width:28rem; display:flex; flex-direction:column; gap:8px; }
    #textq { width:100%; min-height:4.5rem; resize:vertical; box-sizing:border-box; padding:8px; font-family: inherit; font-size:13px;
      color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, #555); border-radius:4px; }
    #askbtn { font-size:13px; padding:8px 14px; cursor:pointer; align-self:flex-start;
      color: var(--vscode-button-foreground); background: var(--vscode-button-background); border:none; border-radius:4px; }
    #askbtn:hover { background: var(--vscode-button-hoverBackground); }
    .hint { font-size:11px; opacity:0.65; max-width:28rem; }
  </style>
</head>
<body>
  <button id="btn" title="Voice">🎙</button>
  <div id="status">Tap the mic to speak, or type a question below (no microphone needed).</div>
  <audio id="player"></audio>
  <div class="row">
    <textarea id="textq" placeholder="Type your question for the model…" rows="3"></textarea>
    <button type="button" id="askbtn">Ask with text</button>
  </div>
  <div class="hint">If macOS never shows a mic toggle for this app, use <strong>Ask with text</strong> to test Groq and ElevenLabs.</div>
  <script>
    const vscode = acquireVsCodeApi();
    const btn = document.getElementById('btn');
    const status = document.getElementById('status');
    const player = document.getElementById('player');
    const textq = document.getElementById('textq');
    const askbtn = document.getElementById('askbtn');

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { status.textContent = 'Speech API not supported in this webview — use “Ask with text” below.'; }

    let rec;

    askbtn.addEventListener('click', () => {
      const text = (textq && textq.value || '').trim();
      if (!text) { status.textContent = 'Type a question first.'; return; }
      status.textContent = 'Sending…';
      vscode.postMessage({ type: 'transcript', text });
    });

    textq.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        askbtn.click();
      }
    });

    btn.addEventListener('click', async () => {
      if (!SR) return;
      status.textContent = 'Requesting microphone (system prompt may appear)…';
      btn.disabled = true;
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(function (t) { t.stop(); });
        } catch (err) {
          var en = err && err.name ? err.name : 'Error';
          status.textContent =
            'Microphone blocked (' + en + '). Use “Ask with text” below. On macOS: System Settings → Privacy & Security → Microphone → enable this editor app, then reload the window.';
          btn.textContent = '🎙';
          btn.disabled = false;
          vscode.postMessage({ type: 'error', message: en === 'NotAllowedError' ? 'not-allowed' : en });
          return;
        }
      }
      rec = new SR();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = 'en-US';
      rec.onstart = function () { status.textContent = 'Listening…'; btn.textContent = '🔴'; };
      rec.onresult = function (e) {
        var text = e.results[0][0].transcript;
        status.textContent = 'Got it!';
        btn.textContent = '🎙';
        btn.disabled = false;
        vscode.postMessage({ type: 'transcript', text: text });
      };
      rec.onerror = function (e) {
        status.textContent = 'Speech: ' + e.error + ' — use “Ask with text” below if this persists.';
        btn.textContent = '🎙';
        btn.disabled = false;
        vscode.postMessage({ type: 'error', message: e.error });
      };
      rec.onend = function () { btn.textContent = '🎙'; btn.disabled = false; };
      try {
        rec.start();
      } catch (e) {
        status.textContent = 'Could not start speech recognition. Use “Ask with text” below.';
        btn.disabled = false;
      }
    });

    window.addEventListener('message', (e) => {
      const m = e.data;
      if (m.type === 'play' && m.data) {
        status.textContent = 'Playing…';
        player.src = 'data:audio/mpeg;base64,' + m.data;
        player.play().catch(() => {});
        player.onended = () => { status.textContent = 'Done. Mic or text again.'; };
      }
      if (m.type === 'thinking') { status.textContent = 'Thinking…'; }
      if (m.type === 'error') {
        var em = m.message || '';
        status.textContent = (em === 'not-allowed' || em === 'NotAllowedError')
          ? 'Microphone denied — use “Ask with text” below.'
          : ('Error: ' + em);
      }
    });
  </script>
</body>
</html>`;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("CodeWhisper");
  context.subscriptions.push(output);

  spawnPython(context.extensionPath, output);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.text = "$(mic) CodeWhisper";
  status.tooltip = "CodeWhisper — Voice Ask (Cmd+Shift+Space when editor focused)";
  status.command = "codewhisper.voiceAsk";
  status.show();
  context.subscriptions.push(status);

  let voicePanel: vscode.WebviewPanel | undefined;

  function attachVoicePanelHandlers(panel: vscode.WebviewPanel): void {
    panel.webview.onDidReceiveMessage(async (msg: { type: string; text?: string; message?: string }) => {
      if (msg.type === "error") {
        status.text = "$(mic) CodeWhisper";
        void vscode.window.showWarningMessage(`CodeWhisper — ${speechMicErrorHint(msg.message)}`);
        return;
      }
      if (msg.type !== "transcript" || !msg.text) return;

      const cfg = vscode.workspace.getConfiguration("codewhisper");
      const groqKey = trimSecret(cfg.get<string>("groqApiKey"));
      const elKey = trimSecret(cfg.get<string>("elevenLabsApiKey"));
      const voiceId = trimSecret(cfg.get<string>("elevenLabsVoiceId"));
      const { code, filename } = getEditorContext();

      if (!groqKey) {
        void vscode.window.showErrorMessage("CodeWhisper: set codewhisper.groqApiKey in settings.");
        return;
      }
      if (!elKey || !voiceId) {
        void vscode.window.showErrorMessage(
          "CodeWhisper: set codewhisper.elevenLabsApiKey and codewhisper.elevenLabsVoiceId in settings."
        );
        return;
      }

      const alive = await ensureBackendAlive(context, output);
      if (!alive) {
        status.text = "$(mic) CodeWhisper";
        void panel.webview.postMessage({ type: "error", message: "Python backend not ready." });
        await offerInstallDeps(context.extensionPath);
        spawnPython(context.extensionPath, output);
        return;
      }

      status.text = "$(loading~spin) CodeWhisper";
      void panel.webview.postMessage({ type: "thinking" });

      const response = await sendToPython(
        {
          type: "ask",
          transcript: msg.text,
          code,
          filename,
          groq_api_key: groqKey,
          elevenlabs_api_key: elKey,
          voice_id: voiceId,
        },
        PYTHON_TIMEOUT_MS
      );

      if (response.type === "error") {
        status.text = "$(mic) CodeWhisper";
        const errText = String(response.message ?? "Unknown error");
        void panel.webview.postMessage({ type: "error", message: errText });
        void vscode.window.showErrorMessage(`CodeWhisper: ${errText}`);
        if (errText.includes("ModuleNotFoundError") || errText.includes("No module named")) {
          await offerInstallDeps(context.extensionPath);
          spawnPython(context.extensionPath, output);
        }
        return;
      }

      status.text = "$(unmute) CodeWhisper";
      void panel.webview.postMessage({ type: "play", data: response.audio_b64 });

      setTimeout(() => {
        status.text = "$(mic) CodeWhisper";
      }, 15000);
    });
  }

  const voiceAsk = vscode.commands.registerCommand("codewhisper.voiceAsk", async () => {
    const cfg = vscode.workspace.getConfiguration("codewhisper");
    const groqKey = trimSecret(cfg.get<string>("groqApiKey"));
    const elKey = trimSecret(cfg.get<string>("elevenLabsApiKey"));
    const voiceId = trimSecret(cfg.get<string>("elevenLabsVoiceId"));

    if (!groqKey) {
      void vscode.window.showErrorMessage("CodeWhisper: set codewhisper.groqApiKey in settings.");
      return;
    }
    if (!elKey || !voiceId) {
      void vscode.window.showErrorMessage(
        "CodeWhisper: set codewhisper.elevenLabsApiKey and codewhisper.elevenLabsVoiceId in settings."
      );
      return;
    }

    const alive = await ensureBackendAlive(context, output);
    if (!alive) {
      await offerInstallDeps(context.extensionPath);
      spawnPython(context.extensionPath, output);
      const retry = await ensureBackendAlive(context, output);
      if (!retry) {
        void vscode.window.showErrorMessage(
          `CodeWhisper: Python backend failed to start. See Output → CodeWhisper. Try: ${pipInstallCommand(context.extensionPath)}`
        );
        return;
      }
    }

    if (voicePanel) {
      voicePanel.reveal(vscode.ViewColumn.Beside);
    } else {
      voicePanel = vscode.window.createWebviewPanel(
        "codewhisperVoice",
        "CodeWhisper",
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      voicePanel.onDidDispose(() => {
        voicePanel = undefined;
      });
      attachVoicePanelHandlers(voicePanel);
    }

    voicePanel.webview.html = getVoiceHtml();
    status.text = "$(mic) listening";
  });

  const installDeps = vscode.commands.registerCommand("codewhisper.installPythonDeps", async () => {
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "CodeWhisper: pip install…" },
        () => runPipInstallDeps(context.extensionPath)
      );
      disposePython();
      spawnPython(context.extensionPath, output);
      const ok = await ensureBackendAlive(context, output);
      void vscode.window.showInformationMessage(
        ok ? "CodeWhisper: Python dependencies OK." : "CodeWhisper: install finished but backend check failed. See Output."
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`CodeWhisper: ${msg}`);
    }
  });

  context.subscriptions.push(voiceAsk, installDeps, { dispose: () => voicePanel?.dispose() });
}

export function deactivate(): void {
  suppressPythonExitLog = true;
  rl?.close();
  rl = undefined;
  pyProc?.removeAllListeners();
  pyProc?.kill();
  pyProc = undefined;
}
