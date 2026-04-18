# CodeWhisper (VS Code)

Ask questions **by voice** about the code in your active editor. The extension sends your speech transcript plus the **current file or selection** to **Groq**, then plays the answer with **ElevenLabs** text-to-speech.

**Not affiliated with Amazon Web Services or AWS CodeWhisperer.** This is an independent open-source extension.

## Requirements

- **Visual Studio Code** 1.85+
- **Python 3** on your `PATH` (`python3` on macOS/Linux, `python` on Windows unless you override it)
- Python package **`httpx`** (see [Python setup](#python-setup))
- **Groq** API key and **ElevenLabs** API key + voice ID

## Python setup

The extension runs a small backend from the installed extension folder:

```bash
python3 -m pip install --user -r /path/to/extension/backend/requirements.txt
```

Easiest from a clone of this repo:

```bash
cd codewhisper/backend && python3 -m pip install --user -r requirements.txt
```

For local development you can instead use a venv inside `codewhisper` and point **CodeWhisper › Python Path** at `codewhisper/.venv/bin/python` (macOS/Linux) or `.venv\\Scripts\\python.exe` (Windows).

After installing the extension from the Marketplace or a `.vsix`, use either:

- Command Palette → **CodeWhisper: Install Python Dependencies** (runs `pip install --user` against `backend/requirements.txt`), or  
- When the backend fails, choose **Install now** or **Copy pip command** from the prompt.

If you use a non-default interpreter, set **CodeWhisper › Python Path** in Settings.

## Extension settings

| Setting | Description |
|--------|-------------|
| `codewhisper.pythonPath` | Optional path to Python (default: `python` on Windows, `python3` elsewhere) |
| `codewhisper.groqApiKey` | Groq API key |
| `codewhisper.elevenLabsApiKey` | ElevenLabs `xi-api-key` |
| `codewhisper.elevenLabsVoiceId` | Voice ID from the ElevenLabs voice library |

## Usage

1. Configure the three API-related settings above.
2. Open a file and focus the editor.
3. Run **CodeWhisper: Voice Ask** from the Command Palette, click the **CodeWhisper** status bar item, or use **Cmd+Shift+Space** (macOS) / **Ctrl+Shift+Space** (Windows/Linux) when the editor is focused.
4. In the side panel, tap the microphone and speak (uses the browser **Web Speech API** inside the webview).

If nothing is selected, **the whole file** is sent as context (truncated on the server side). With a selection, only the selection is sent.

## Speech recognition limitations

Recognition runs in an embedded webview (Chromium). Availability and quality depend on **OS**, **VS Code version**, and **network** (where the engine requires it). If you see “Speech API not supported”, use a different environment or keyboard input (future versions may add alternatives).

## Privacy

- **Transcript and code context** are sent to **Groq** for the model response.
- **Model output text** is sent to **ElevenLabs** to synthesize audio.
- **Do not use** with code or speech you are not allowed to send to those services.

Logs from the Python process appear under **Output → CodeWhisper**.

## Development

```bash
cd codewhisper && npm install && npm run compile
```

Press **F5** (Run Extension) from the `codewhisper` folder.

## Publishing

Source: [github.com/pulkitgovrani/codewhisper](https://github.com/pulkitgovrani/codewhisper). The `publisher` field in `package.json` must match the **publisher id** shown in [Visual Studio Marketplace](https://marketplace.visualstudio.com/manage) or [Open VSX](https://open-vsx.org/) (it is currently set to **codewhisperer**; if `vsce` rejects it, use the exact id from your publisher page).

From the `codewhisper` folder, use a clean `out/` so old builds are not bundled:

```bash
rm -rf out && npm install && npm run compile && npx @vscode/vsce package
```

This produces `codewhisper-1.0.0.vsix` (version follows `package.json`).
