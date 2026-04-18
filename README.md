# CodeWhisper (VS Code)

In the Extensions sidebar and Marketplace, this extension is shown as **CodeWhisper** (`displayName` in `package.json`). The shorter field `name` is only the technical id (`codewhisperer.codewhisper-voice`); it does not replace that title.

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
4. In the side panel, either **tap the microphone** and speak (Web Speech API), or **type a question** and click **Ask with text** (same pipeline, no microphone).

If nothing is selected, **the whole file** is sent as context (truncated on the server side). With a selection, only the selection is sent.

## Speech recognition limitations

Recognition runs in an embedded webview (Chromium). Availability and quality depend on **OS**, **VS Code version**, and **network** (where the engine requires it). If you see “Speech API not supported”, use a different environment or keyboard input (future versions may add alternatives).

### “Mic error: not-allowed”

That means the **OS denied the microphone** to the editor process (not your Groq/Eleven keys).

- **macOS:** **System Settings → Privacy & Security → Microphone** — enable **Visual Studio Code** and/or **Cursor** (whichever you use). If it was off, turn it on, then in VS Code run **Developer: Reload Window** and try Voice Ask again.
- **Windows:** **Settings → Privacy & security → Microphone** — allow microphone access and allow **Visual Studio Code** for desktop apps.
- **Linux:** varies by distro; allow the browser/Electron app to use the mic (PipeWire/PulseAudio, Flatpak portal, etc.).

If you previously clicked **Don’t allow**, reset the choice in the same privacy screen or remove/re-add the app from the list where applicable.

**macOS never shows VS Code / Cursor under Microphone**

- The list often **only fills after** the app has tried to use the mic. Try Voice Ask → mic once, then reopen **System Settings → Privacy & Security → Microphone** and scroll the full list (VS Code and Cursor are separate entries).
- **Cursor** and **Visual Studio Code** are different apps — enable the one you actually launch.
- Some Electron builds still never trigger the system prompt from a webview; use **Ask with text** in the CodeWhisper panel to verify Groq + ElevenLabs anyway.
- To reset only VS Code’s mic decision (Terminal):  
  `tccutil reset Microphone com.microsoft.VSCode`  
  Then restart VS Code and try the mic again (you may need to approve once). For **Cursor**, get its bundle id with `osascript -e 'id of app "Cursor"'` and run `tccutil reset Microphone <that-id>` the same way.

### ElevenLabs `401 Unauthorized`

That means ElevenLabs **rejected your API key** (wrong, expired, or copied with extra characters).

1. In [ElevenLabs](https://elevenlabs.io), open **API keys** (from your profile / developer settings) and copy the key used for HTTP requests (`xi-api-key`).
2. In VS Code: **Settings** → **Codewhisper: Elevenlabs Api Key** — paste only the key (no `Bearer` prefix, no quotes). The extension **trims** leading/trailing spaces (v1.0.2+).
3. **Developer: Reload Window** and try **Ask with text** again. The voice ID must belong to the **same** ElevenLabs account as that key.

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

**Mic troubleshooting:** the panel first calls **`getUserMedia`** so macOS can show a real microphone prompt; only then it starts Web Speech. If you still see `not-allowed`, use **Ask with text** or enable the app under **System Settings → Privacy & Security → Microphone** and **Developer: Reload Window**.
