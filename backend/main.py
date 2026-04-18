import sys
import json
import base64
import subprocess

import groq_client
import elevenlabs_client
import mic_server


def open_browser(url: str) -> None:
    subprocess.Popen(
        ["open", url],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def handle(msg: dict) -> dict:
    if msg.get("type") == "ping":
        return {"type": "pong"}

    if msg.get("type") == "stt":
        el_api_key = msg.get("elevenlabs_api_key", "")
        if not el_api_key:
            return {"type": "error", "message": "elevenLabsApiKey is not set."}
        audio_bytes = base64.b64decode(msg.get("audio_b64", ""))
        transcript = elevenlabs_client.transcribe(audio_bytes, el_api_key)
        return {"type": "stt_result", "transcript": transcript}

    if msg.get("type") == "voice_ask":
        groq_api_key = str(msg.get("groq_api_key", "")).strip()
        el_api_key = str(msg.get("elevenlabs_api_key", "")).strip()
        voice_id = str(msg.get("voice_id", "")).strip()
        code = str(msg.get("code", ""))
        filename = str(msg.get("filename", ""))

        if not groq_api_key:
            return {"type": "error", "message": "groqApiKey is not set."}
        if not el_api_key or not voice_id:
            return {"type": "error", "message": "elevenLabsApiKey or elevenLabsVoiceId is not set."}

        # 1. Capture mic audio via browser
        try:
            audio_bytes = mic_server.capture_audio_via_browser(open_browser)
        except TimeoutError:
            return {"type": "error", "message": "No audio received (timed out)."}

        # 2. STT
        transcript = elevenlabs_client.transcribe(audio_bytes, el_api_key)
        if not transcript.strip():
            return {"type": "error", "message": "No speech detected."}

        # 3. LLM
        text = groq_client.ask(transcript, code, filename, groq_api_key)

        # 4. TTS
        audio_out = elevenlabs_client.synthesize(text, el_api_key, voice_id)
        audio_b64 = base64.b64encode(audio_out).decode("utf-8")

        return {"type": "response", "transcript": transcript, "text": text, "audio_b64": audio_b64}

    if msg.get("type") == "ask":
        transcript = msg.get("transcript", "")
        code = msg.get("code", "")
        filename = msg.get("filename", "")
        groq_api_key = msg.get("groq_api_key", "")
        el_api_key = msg.get("elevenlabs_api_key", "")
        voice_id = msg.get("voice_id", "")

        if not groq_api_key:
            return {"type": "error", "message": "groqApiKey is not set."}

        text = groq_client.ask(transcript, code, filename, groq_api_key)

        if not el_api_key or not voice_id:
            return {"type": "error", "message": "elevenLabsApiKey or elevenLabsVoiceId is not set."}

        audio_bytes = elevenlabs_client.synthesize(text, el_api_key, voice_id)
        audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")

        return {"type": "response", "text": text, "audio_b64": audio_b64}

    return {"type": "error", "message": f"Unknown message type: {msg.get('type')}"}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            result = handle(msg)
        except Exception as e:
            result = {"type": "error", "message": str(e)}
        sys.stdout.write(json.dumps(result) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
