import httpx


def synthesize(text: str, api_key: str, voice_id: str) -> bytes:
    api_key = (api_key or "").strip()
    voice_id = (voice_id or "").strip()
    if not api_key:
        raise ValueError("ElevenLabs API key is empty.")

    resp = httpx.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        headers={"xi-api-key": api_key, "Content-Type": "application/json"},
        json={
            "text": text,
            "model_id": "eleven_flash_v2_5",
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
        },
        timeout=30,
    )

    if resp.status_code == 401:
        extra = ""
        try:
            data = resp.json()
            detail = data.get("detail")
            if isinstance(detail, dict):
                extra = str(detail.get("message") or detail.get("status") or "")[:180]
            elif isinstance(detail, str):
                extra = detail[:180]
        except Exception:
            extra = (resp.text or "")[:180]
        raise ValueError(
            "ElevenLabs 401 Unauthorized — the xi-api-key was rejected. "
            "Open https://elevenlabs.io → profile / API keys, copy your **API key** (not a webhook secret), "
            "paste it into Settings as codewhisper.elevenLabsApiKey with no spaces or quotes."
            + (f" Detail: {extra}" if extra else "")
        ) from None

    resp.raise_for_status()
    return resp.content
