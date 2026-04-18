import sys
import json
import base64

import groq_client
import elevenlabs_client


def handle(msg: dict) -> dict:
    if msg.get("type") == "ping":
        return {"type": "pong"}

    if msg.get("type") != "ask":
        return {"type": "error", "message": f"Unknown message type: {msg.get('type')}"}

    transcript = str(msg.get("transcript", "")).strip()
    code = str(msg.get("code", ""))
    filename = str(msg.get("filename", ""))
    groq_api_key = str(msg.get("groq_api_key", "")).strip()
    el_api_key = str(msg.get("elevenlabs_api_key", "")).strip()
    voice_id = str(msg.get("voice_id", "")).strip()

    if not groq_api_key:
        return {"type": "error", "message": "groqApiKey is not set."}

    text = groq_client.ask(transcript, code, filename, groq_api_key)

    if not el_api_key or not voice_id:
        return {"type": "error", "message": "elevenLabsApiKey or elevenLabsVoiceId is not set."}

    audio_bytes = elevenlabs_client.synthesize(text, el_api_key, voice_id)
    audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")

    return {"type": "response", "text": text, "audio_b64": audio_b64}


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
