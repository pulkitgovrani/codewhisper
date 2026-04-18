import * as vscode from "vscode";
import type { ExplainResult } from "../types";

export class ExplainPanel {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private readonly extUri: vscode.Uri) {}

  show(result: ExplainResult, audio?: { mime: string; base64: string }): void {
    if (this.panel) {
      this.panel.dispose();
    }
    this.panel = vscode.window.createWebviewPanel(
      "codewhisperExplain",
      "CodeWhisper: Explanation",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extUri],
      }
    );
    this.panel.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === "ready" && audio) {
        void this.panel?.webview.postMessage({
          type: "play",
          mime: audio.mime,
          data: audio.base64,
        });
      }
    });
    this.panel.webview.html = getHtml(result, audio);
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  postStop(): void {
    void this.panel?.webview.postMessage({ type: "stop" });
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getHtml(result: ExplainResult, audio?: { mime: string; base64: string }): string {
  const sug =
    result.suggestions.length > 0
      ? `<h3>Suggestions</h3><ul>${result.suggestions.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>`
      : "";
  const warn = result.warnings
    ? `<h3>Warnings</h3><p>${escapeHtml(result.warnings)}</p>`
    : "";
  const playHint = audio
    ? "<p><em>Playing audio…</em></p>"
    : "<p><em>No ElevenLabs audio (see settings or audio fallback).</em></p>";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src * blob: data:;">
  <style>
    body { font-family: var(--vscode-font-family); font-size: 13px; color: var(--vscode-foreground); padding: 12px; }
    h2 { font-size: 1.1em; margin-top: 0; }
    h3 { font-size: 1em; margin-bottom: 0.4em; }
    p { line-height: 1.45; }
    ul { padding-left: 1.2em; }
  </style>
</head>
<body>
  <h2>Summary</h2>
  <p>${escapeHtml(result.summary)}</p>
  <h3>Complexity</h3>
  <p>${escapeHtml(result.complexity || "—")}</p>
  ${sug}
  ${warn}
  ${playHint}
  <audio id="player" controls style="width:100%;margin-top:12px;"></audio>
  <script>
    const vscode = acquireVsCodeApi();
    const player = document.getElementById('player');
    window.addEventListener('message', (e) => {
      const m = e.data;
      if (m.type === 'play' && m.data) {
        player.pause();
        player.src = 'data:' + m.mime + ';base64,' + m.data;
        player.play().catch(() => {});
      }
      if (m.type === 'stop') {
        player.pause();
        player.removeAttribute('src');
      }
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
