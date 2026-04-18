import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import * as readline from "readline";

let pyProc: cp.ChildProcess | undefined;
let rl: readline.Interface | undefined;
let pendingResolve: ((msg: Record<string, unknown>) => void) | undefined;

function spawnPython(extPath: string): void {
  const script = path.join(extPath, "backend", "main.py");
  pyProc = cp.spawn("python3", [script], { stdio: ["pipe", "pipe", "pipe"] });
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
    console.error("[codewhisper python]", d.toString());
  });
}

function sendToPython(msg: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    pendingResolve = resolve;
    pyProc?.stdin?.write(JSON.stringify(msg) + "\n");
  });
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src blob: data:;">
  <style>
    body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-foreground); display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; margin:0; gap:16px; }
    button { font-size:48px; background:none; border:none; cursor:pointer; }
    #status { font-size:14px; opacity:0.7; }
    audio { display:none; }
  </style>
</head>
<body>
  <button id="btn">🎙</button>
  <div id="status">Tap to speak</div>
  <audio id="player"></audio>
  <script>
    const vscode = acquireVsCodeApi();
    const btn = document.getElementById('btn');
    const status = document.getElementById('status');
    const player = document.getElementById('player');

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { status.textContent = 'Speech API not supported'; }

    let rec;

    btn.addEventListener('click', () => {
      if (!SR) return;
      rec = new SR();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = 'en-US';
      rec.onstart = () => { status.textContent = 'Listening…'; btn.textContent = '🔴'; };
      rec.onresult = (e) => {
        const text = e.results[0][0].transcript;
        status.textContent = 'Got it!';
        btn.textContent = '🎙';
        vscode.postMessage({ type: 'transcript', text });
      };
      rec.onerror = (e) => {
        status.textContent = 'Error: ' + e.error;
        btn.textContent = '🎙';
        vscode.postMessage({ type: 'error', message: e.error });
      };
      rec.onend = () => { btn.textContent = '🎙'; };
      rec.start();
    });

    window.addEventListener('message', (e) => {
      const m = e.data;
      if (m.type === 'play' && m.data) {
        status.textContent = 'Playing…';
        player.src = 'data:audio/mpeg;base64,' + m.data;
        player.play().catch(() => {});
        player.onended = () => { status.textContent = 'Done. Tap to speak again.'; };
      }
      if (m.type === 'thinking') { status.textContent = 'Thinking…'; }
      if (m.type === 'error') { status.textContent = 'Error: ' + m.message; }
    });
  </script>
</body>
</html>`;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  spawnPython(context.extensionPath);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.text = "● ready";
  status.tooltip = "CodeWhisper — Cmd+Shift+Space to speak";
  status.show();
  context.subscriptions.push(status);

  let voicePanel: vscode.WebviewPanel | undefined;

  const voiceAsk = vscode.commands.registerCommand("codewhisper.voiceAsk", async () => {
    const cfg = vscode.workspace.getConfiguration("codewhisper");
    const groqKey = cfg.get<string>("groqApiKey") ?? "";
    const elKey = cfg.get<string>("elevenLabsApiKey") ?? "";
    const voiceId = cfg.get<string>("elevenLabsVoiceId") ?? "";

    if (!groqKey) {
      void vscode.window.showErrorMessage("CodeWhisper: set codewhisper.groqApiKey in settings.");
      return;
    }

    const { code, filename } = getEditorContext();

    if (voicePanel) {
      voicePanel.reveal(vscode.ViewColumn.Beside);
    } else {
      voicePanel = vscode.window.createWebviewPanel(
        "codewhisperVoice",
        "CodeWhisper",
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      voicePanel.onDidDispose(() => { voicePanel = undefined; });
    }

    voicePanel.webview.html = getVoiceHtml();
    status.text = "🎙 listening";

    voicePanel.webview.onDidReceiveMessage(async (msg: { type: string; text?: string; message?: string }) => {
      if (msg.type === "error") {
        status.text = "● ready";
        void vscode.window.showWarningMessage(`CodeWhisper mic error: ${msg.message}`);
        return;
      }
      if (msg.type !== "transcript" || !msg.text) return;

      status.text = "⏳ thinking";
      void voicePanel?.webview.postMessage({ type: "thinking" });

      const response = await sendToPython({
        type: "ask",
        transcript: msg.text,
        code,
        filename,
        groq_api_key: groqKey,
        elevenlabs_api_key: elKey,
        voice_id: voiceId,
      });

      if (response.type === "error") {
        status.text = "● ready";
        void voicePanel?.webview.postMessage({ type: "error", message: response.message });
        void vscode.window.showErrorMessage(`CodeWhisper: ${String(response.message)}`);
        return;
      }

      status.text = "🔊 speaking";
      void voicePanel?.webview.postMessage({ type: "play", data: response.audio_b64 });

      // Reset status after ~10s (audio length unknown without decoding)
      setTimeout(() => { status.text = "● ready"; }, 10000);
    });
  });

  context.subscriptions.push(voiceAsk, { dispose: () => voicePanel?.dispose() });
}

export function deactivate(): void {
  pyProc?.kill();
}
