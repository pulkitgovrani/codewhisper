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
  await execFileAsync(py, ["-m", "pip", "install", "--user", "-r", req], { windowsHide: true });
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
    } catch { /* ignore */ }
  });

  pyProc.stderr!.on("data", (d: Buffer) => {
    const s = d.toString();
    stderrBuf += s;
    output.appendLine(s.trimEnd());
  });

  pyProc.on("error", (err: NodeJS.ErrnoException) => {
    void vscode.window.showErrorMessage(
      `CodeWhisper: could not start Python (${py}). ${err.message}`
    );
  });

  pyProc.on("exit", (code, signal) => {
    if (suppressPythonExitLog) { suppressPythonExitLog = false; return; }
    const hint = stderrBuf.includes("ModuleNotFoundError") ? ` Try: ${pipInstallCommand(extPath)}` : "";
    output.appendLine(`Python backend exited (${signal ?? `code ${code}`}).${hint}`);
    output.show(true);
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
      resolve({ type: "error", message: "Request timed out." });
    }, timeoutMs);
    pendingResolve = (r) => { clearTimeout(timer); resolve(r); };
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

function getEditorContext(): { code: string; filename: string } {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return { code: "", filename: "" };
  const selection = editor.selection;
  const code = selection.isEmpty ? editor.document.getText() : editor.document.getText(selection);
  return { code, filename: editor.document.fileName };
}

function showResultPanel(context: vscode.ExtensionContext, transcript: string, answer: string, audioB64: string): void {
  const panel = vscode.window.createWebviewPanel(
    "codewhisperAudio", "CodeWhisper", vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: false }
  );
  const esc = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  panel.webview.html = `<!DOCTYPE html><html><head>
    <meta charset="UTF-8"/>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src blob: data:;">
    <style>
      body { font-family: var(--vscode-font-family); font-size:13px; color:var(--vscode-foreground); padding:16px; line-height:1.5; }
      .label { font-size:11px; opacity:0.5; text-transform:uppercase; letter-spacing:.05em; margin-bottom:4px; }
      .bubble { background:var(--vscode-editor-inactiveSelectionBackground); border-radius:6px; padding:10px 14px; margin-bottom:16px; }
    </style>
    </head><body>
    <div class="label">You asked</div>
    <div class="bubble">${esc(transcript)}</div>
    <div class="label">Answer</div>
    <div class="bubble">${esc(answer)}</div>
    <div class="label">Audio</div>
    <audio id="p" controls style="width:100%;margin-top:4px"></audio>
    <script>
    const p = document.getElementById('p');
    p.src = 'data:audio/mpeg;base64,${audioB64}';
    p.play().catch(e => console.error('autoplay failed:', e));
    </script></body></html>`;
  void context;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("CodeWhisper");
  context.subscriptions.push(output);

  spawnPython(context.extensionPath, output);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.text = "● ready";
  status.tooltip = "CodeWhisper — Cmd+Shift+Space";
  status.command = "codewhisper.voiceAsk";
  status.show();
  context.subscriptions.push(status);

  const voiceAsk = vscode.commands.registerCommand("codewhisper.voiceAsk", async () => {
    const cfg = vscode.workspace.getConfiguration("codewhisper");
    const groqKey = trimSecret(cfg.get<string>("groqApiKey"));
    const elKey = trimSecret(cfg.get<string>("elevenLabsApiKey"));
    const voiceId = trimSecret(cfg.get<string>("elevenLabsVoiceId"));

    if (!groqKey || !elKey || !voiceId) {
      void vscode.window.showErrorMessage("CodeWhisper: set groqApiKey, elevenLabsApiKey, elevenLabsVoiceId in settings.");
      return;
    }

    const alive = await ensureBackendAlive(context, output);
    if (!alive) {
      void vscode.window.showErrorMessage(`CodeWhisper: Python backend failed. Try: ${pipInstallCommand(context.extensionPath)}`);
      return;
    }

    const { code, filename } = getEditorContext();

    status.text = "🎙 listening";

    // Python opens browser, records audio, does STT+LLM+TTS, returns audio
    const response = await sendToPython(
      { type: "voice_ask", code, filename, groq_api_key: groqKey, elevenlabs_api_key: elKey, voice_id: voiceId },
      PYTHON_TIMEOUT_MS
    );

    if (response.type === "error") {
      status.text = "● ready";
      void vscode.window.showErrorMessage(`CodeWhisper: ${String(response.message)}`);
      output.appendLine(`[error] ${String(response.message)}`);
      output.show(true);
      return;
    }

    status.text = "🔊 speaking";
    output.appendLine(`[transcript] ${String(response.transcript ?? "")}`);
    output.appendLine(`[answer] ${String(response.text ?? "")}`);
    output.appendLine(`[audio_b64 length] ${String(response.audio_b64 ?? "").length}`);
    showResultPanel(context, String(response.transcript ?? ""), String(response.text ?? ""), String(response.audio_b64));
    setTimeout(() => { status.text = "● ready"; }, 15000);
  });

  const installDeps = vscode.commands.registerCommand("codewhisper.installPythonDeps", async () => {
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "CodeWhisper: pip install…" },
        () => runPipInstallDeps(context.extensionPath)
      );
      disposePython();
      spawnPython(context.extensionPath, output);
      void vscode.window.showInformationMessage("CodeWhisper: Python dependencies installed.");
    } catch (e) {
      void vscode.window.showErrorMessage(`CodeWhisper: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  context.subscriptions.push(voiceAsk, installDeps);
}

export function deactivate(): void {
  suppressPythonExitLog = true;
  rl?.close();
  rl = undefined;
  pyProc?.removeAllListeners();
  pyProc?.kill();
  pyProc = undefined;
}
