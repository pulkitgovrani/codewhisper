import base64
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>CodeWhisper</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: #1e1e1e; color: #ccc;
           display: flex; flex-direction: column; align-items: center;
           justify-content: center; height: 100vh; gap: 20px; }
    #btn { font-size: 56px; background: none; border: none; cursor: pointer; user-select: none; }
    #status { font-size: 14px; opacity: 0.6; }
  </style>
</head>
<body>
  <button id="btn">🎙</button>
  <div id="status">Tap to speak</div>
  <script>
    const btn = document.getElementById('btn');
    const status = document.getElementById('status');
    let recorder, chunks = [], recording = false;

    btn.addEventListener('click', async () => {
      if (recording) { recorder.stop(); return; }
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (e) { status.textContent = 'Mic denied: ' + e.message; return; }

      chunks = [];
      recorder = new MediaRecorder(stream);
      recording = true;
      btn.textContent = '🔴';
      status.textContent = 'Recording… tap to stop';

      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        recording = false;
        btn.textContent = '⏳';
        status.textContent = 'Processing…';
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const buf = await blob.arrayBuffer();
        const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        try {
          await fetch('/audio', { method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio_b64: b64 }) });
          status.textContent = 'Done! You can close this tab.';
          btn.textContent = '✅';
        } catch (e) {
          status.textContent = 'Upload failed: ' + e.message;
          btn.textContent = '🎙';
        }
      };
      recorder.start();
    });
  </script>
</body>
</html>"""


class _Handler(BaseHTTPRequestHandler):
    audio_b64: str | None = None
    ready_event: threading.Event = threading.Event()

    def log_message(self, *args):
        pass  # silence request logs

    def do_GET(self):
        body = HTML.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        data = json.loads(self.rfile.read(length))
        _Handler.audio_b64 = data.get("audio_b64", "")
        self.send_response(200)
        self.end_headers()
        _Handler.ready_event.set()


def capture_audio_via_browser(open_url_fn) -> bytes:
    """Start a one-shot HTTP server, call open_url_fn(url), wait for audio POST, return bytes."""
    _Handler.audio_b64 = None
    _Handler.ready_event.clear()

    server = HTTPServer(("127.0.0.1", 0), _Handler)
    port = server.server_address[1]

    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()

    open_url_fn(f"http://127.0.0.1:{port}")

    _Handler.ready_event.wait(timeout=120)
    server.shutdown()

    if not _Handler.audio_b64:
        raise TimeoutError("No audio received within 120 seconds.")

    return base64.b64decode(_Handler.audio_b64)
