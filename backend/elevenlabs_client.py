from elevenlabs.client import ElevenLabs


def transcribe(audio_bytes: bytes, api_key: str) -> str:
    client = ElevenLabs(api_key=api_key)
    result = client.speech_to_text.convert(
        file=("audio.webm", audio_bytes, "audio/webm"),
        model_id="scribe_v2",
    )
    return result.text.strip()


def synthesize(text: str, api_key: str, voice_id: str) -> bytes:
    client = ElevenLabs(api_key=api_key)
    audio = client.text_to_speech.convert(
        text=text,
        voice_id=voice_id,
        model_id="eleven_flash_v2_5",
    )
    return b"".join(audio)
