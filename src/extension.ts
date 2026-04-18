import * as vscode from "vscode";
import { extractContext } from "./context/extractContext";
import { explainCode } from "./llm/explain";
import { buildSpeechText, type DetailLevel } from "./tts/buildSpeechText";
import { synthesizeElevenLabs } from "./tts/elevenlabsTts";
import { speakWithMacSay } from "./tts/localSay";
import { ExplainPanel } from "./ui/explainPanel";

const LLM_KEY = "codewhisper.llmApiKey";
const EL_KEY = "codewhisper.elevenlabsApiKey";

let output: vscode.OutputChannel;
let panel!: ExplainPanel;
let speakingAbort: AbortController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel("CodeWhisper");
  output.appendLine("CodeWhisper activated.");
  panel = new ExplainPanel(context.extensionUri);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.text = "$(unmute) CodeWhisper";
  status.tooltip = "CodeWhisper: explain selection";
  status.command = "codewhisper.explainSelection";
  status.show();
  context.subscriptions.push(status);

  const setSpeaking = (on: boolean) => {
    void vscode.commands.executeCommand("setContext", "codewhisper.speaking", on);
  };

  const explain = async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showWarningMessage("CodeWhisper: open a text editor first.");
      return;
    }
    const sch = editor.document.uri.scheme;
    if (sch === "vscode-notebook-cell") {
      void vscode.window.showWarningMessage(
        "CodeWhisper: notebooks are not supported yet. Use a regular file buffer."
      );
      return;
    }
    if (sch !== "file" && sch !== "untitled") {
      void vscode.window.showWarningMessage("CodeWhisper: unsupported document scheme.");
      return;
    }

    const cfg = vscode.workspace.getConfiguration("codewhisper");
    const maxSel = cfg.get<number>("maxSelectionChars") ?? 12000;
    const maxLines = cfg.get<number>("maxContextLinesWhenNoSelection") ?? 80;

    const extracted = await extractContext(editor, maxSel, maxLines);
    if (extracted.error) {
      void vscode.window.showWarningMessage(extracted.error);
      return;
    }
    if (!extracted.context.code.trim()) {
      void vscode.window.showWarningMessage("CodeWhisper: nothing to explain (empty context).");
      return;
    }

    const llmKey = await context.secrets.get(LLM_KEY);
    if (!llmKey) {
      void vscode.window.showErrorMessage(
        "CodeWhisper: set your LLM API key (command: CodeWhisper: Set LLM API Key)."
      );
      return;
    }

    speakingAbort?.abort();
    speakingAbort = new AbortController();

    status.text = "$(sync~spin) CodeWhisper: explaining…";
    try {
      const baseUrl = cfg.get<string>("llmBaseUrl") ?? "https://api.openai.com/v1";
      const model = cfg.get<string>("llmModel") ?? "gpt-4o-mini";
      const timeoutMs = cfg.get<number>("llmTimeoutMs") ?? 60000;

      const result = await explainCode({
        baseUrl,
        model,
        apiKey: llmKey,
        timeoutMs,
        ctx: extracted.context,
      });

      if (extracted.context.truncated) {
        void vscode.window.showInformationMessage(
          "CodeWhisper: context was truncated to your max length setting."
        );
      }

      const detail = (cfg.get<string>("detailLevel") ?? "standard") as DetailLevel;
      const speechText = buildSpeechText(result, detail);

      const elevenKey = await context.secrets.get(EL_KEY);
      const voiceId = cfg.get<string>("elevenlabsVoiceId") ?? "";
      const ttsModel = cfg.get<string>("elevenlabsTtsModel") ?? "eleven_turbo_v2_5";
      const fallback = cfg.get<string>("audioFallback") ?? "none";

      let audio:
        | {
            mime: string;
            base64: string;
          }
        | undefined;

      setSpeaking(true);
      if (elevenKey && voiceId.trim()) {
        try {
          const bytes = await synthesizeElevenLabs({
            apiKey: elevenKey,
            voiceId,
            modelId: ttsModel,
            text: speechText,
            signal: speakingAbort.signal,
          });
          audio = {
            mime: "audio/mpeg",
            base64: Buffer.from(bytes).toString("base64"),
          };
        } catch (e) {
          output.appendLine(`ElevenLabs error: ${String(e)}`);
          if (fallback === "local") {
            await speakWithMacSay(speechText);
          } else {
            void vscode.window.showWarningMessage(
              `CodeWhisper: TTS failed (${String(e)}). Text is still shown in the panel.`
            );
          }
        }
      } else if (fallback === "local") {
        try {
          await speakWithMacSay(speechText);
        } catch (e) {
          void vscode.window.showWarningMessage(`CodeWhisper: local TTS failed: ${String(e)}`);
        }
      } else {
        void vscode.window.showInformationMessage(
          "CodeWhisper: add ElevenLabs API key + voice id for spoken output, or set audio fallback to local on macOS."
        );
      }

      panel.show(result, audio);
      setSpeaking(false);
      status.text = "$(unmute) CodeWhisper";
    } catch (e) {
      setSpeaking(false);
      status.text = "$(error) CodeWhisper";
      output.appendLine(String(e));
      void vscode.window.showErrorMessage(`CodeWhisper: ${String(e)}`);
      status.text = "$(unmute) CodeWhisper";
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("codewhisper.explainSelection", explain),
    vscode.commands.registerCommand("codewhisper.stopSpeaking", () => {
      speakingAbort?.abort();
      speakingAbort = new AbortController();
      panel.postStop();
      setSpeaking(false);
      status.text = "$(unmute) CodeWhisper";
    }),
    vscode.commands.registerCommand("codewhisper.setLlmApiKey", async () => {
      const key = await vscode.window.showInputBox({
        title: "CodeWhisper: LLM API Key",
        password: true,
        ignoreFocusOut: true,
        placeHolder: "OpenAI-compatible API key",
      });
      if (key) {
        await context.secrets.store(LLM_KEY, key);
        void vscode.window.showInformationMessage("CodeWhisper: LLM API key saved.");
      }
    }),
    vscode.commands.registerCommand("codewhisper.setElevenLabsApiKey", async () => {
      const key = await vscode.window.showInputBox({
        title: "CodeWhisper: ElevenLabs API Key",
        password: true,
        ignoreFocusOut: true,
        placeHolder: "xi-api-key from ElevenLabs",
      });
      if (key) {
        await context.secrets.store(EL_KEY, key);
        void vscode.window.showInformationMessage("CodeWhisper: ElevenLabs API key saved.");
      }
    }),
    output,
    status,
    { dispose: () => panel.dispose() }
  );
}

export function deactivate(): void {
  speakingAbort?.abort();
  panel?.dispose();
}
