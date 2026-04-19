# CodeWhisper (VS Code)

In the Extensions sidebar and Marketplace, this extension is shown as **CodeWhisper** (`displayName` in `package.json`). The shorter field `name` is only the technical id (`codewhisperer.codewhisper-voice`); it does not replace that title.

Ask questions **by voice** about the code in your active editor. Recording runs in an **in-editor webview** (tap the octopus). The extension sends your speech (transcribed by **ElevenLabs**) plus **structured code context** from the file to **Groq**, then plays the answer with **ElevenLabs** text-to-speech. The code region used for context is **highlighted** in the editor until you close the answer panel.

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
| `codewhisper.elevenLabsApiKey` | ElevenLabs `xi-api-key` (speech-to-text and text-to-speech) |
| `codewhisper.elevenLabsVoiceId` | Voice ID from the ElevenLabs voice library |
| `codewhisper.contextMode` | What to send as code context: `fullFile`, `selection` (or whole file if nothing selected), `visibleRange`, or `selectionSurrounding` (default) |
| `codewhisper.contextSurroundLines` | Lines above/below the selection when using `selectionSurrounding` (default `20`) |
| `codewhisper.maxContextChars` | Maximum characters of formatted context sent to Groq (default `8000`) |

## Usage

1. Configure the API-related settings above (Groq + ElevenLabs keys and voice ID).
2. Open a file and focus the editor.
3. Run **CodeWhisper: Voice Ask** from the Command Palette, click the **CodeWhisper** status bar item, or use **Cmd+Shift+Space** (macOS) / **Ctrl+Shift+Space** (Windows/Linux) when the editor is focused.
4. A **CodeWhisper — speak** panel opens in the editor. **Tap the octopus** to start recording, **tap again** to stop. Your audio is uploaded to the Python backend for transcription; then a second panel shows the transcript, answer, and playback controls.

Context is built according to **context mode** (see table above). For `selectionSurrounding`, extra lines around the selection are included when possible, and truncation prefers keeping the selected lines intact. The Python backend can still capture audio via a **system browser** only if no audio is supplied (e.g. custom tooling); normal use stays inside VS Code.

## Speech recognition limitations

Recording uses the webview’s **`getUserMedia`** pipeline (Chromium inside VS Code). **Transcription** is done by **ElevenLabs** in the Python backend, not the browser’s Web Speech API. Mic availability still depends on **OS permissions** for VS Code or Cursor.

### “Mic error: not-allowed”

That means the **OS denied the microphone** to the editor process (not your Groq/Eleven keys).

- **macOS:** **System Settings → Privacy & Security → Microphone** — enable **Visual Studio Code** and/or **Cursor** (whichever you use). If it was off, turn it on, then in VS Code run **Developer: Reload Window** and try Voice Ask again.
- **Windows:** **Settings → Privacy & security → Microphone** — allow microphone access and allow **Visual Studio Code** for desktop apps.
- **Linux:** varies by distro; allow the browser/Electron app to use the mic (PipeWire/PulseAudio, Flatpak portal, etc.).

If you previously clicked **Don’t allow**, reset the choice in the same privacy screen or remove/re-add the app from the list where applicable.

**macOS never shows VS Code / Cursor under Microphone**

- The list often **only fills after** the app has tried to use the mic. Try Voice Ask → mic once, then reopen **System Settings → Privacy & Security → Microphone** and scroll the full list (VS Code and Cursor are separate entries).
- **Cursor** and **Visual Studio Code** are different apps — enable the one you actually launch.
- Some Electron builds still never trigger the system prompt from a webview; confirm keys under **Output → CodeWhisper** after a successful run, or test the Python backend separately.
- To reset only VS Code’s mic decision (Terminal):  
  `tccutil reset Microphone com.microsoft.VSCode`  
  Then restart VS Code and try the mic again (you may need to approve once). For **Cursor**, get its bundle id with `osascript -e 'id of app "Cursor"'` and run `tccutil reset Microphone <that-id>` the same way.

### ElevenLabs `401 Unauthorized`

That means ElevenLabs **rejected your API key** (wrong, expired, or copied with extra characters).

1. In [ElevenLabs](https://elevenlabs.io), open **API keys** (from your profile / developer settings) and copy the key used for HTTP requests (`xi-api-key`).
2. In VS Code: **Settings** → **Codewhisper: Elevenlabs Api Key** — paste only the key (no `Bearer` prefix, no quotes). The extension **trims** leading/trailing spaces (v1.0.3+).
3. **Developer: Reload Window** and try **Voice Ask** again. The voice ID must belong to the **same** ElevenLabs account as that key.

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

This produces `codewhisper-voice-<version>.vsix` (from the `name` and `version` fields in `package.json`).

**Mic troubleshooting:** the recorder webview calls **`getUserMedia`** so the OS can prompt for microphone access. If you still see `not-allowed`, enable the app under **System Settings → Privacy & Security → Microphone** (macOS) or Windows microphone privacy settings, then **Developer: Reload Window**.
