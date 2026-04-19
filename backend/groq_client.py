import httpx

SYSTEM_PROMPT = (
    "You are a coding buddy. "
    "Answer in 2-3 plain spoken sentences. "
    "No markdown, no bullet points, no code blocks."
)


def ask(transcript: str, context_body: str, api_key: str, max_chars: int = 8000) -> str:
    """Build user message from spoken question plus optional formatted code context."""
    parts: list[str] = []
    t = (transcript or "").strip()
    if t:
        parts.append(t)
    cb = (context_body or "").strip()
    if cb:
        tb = cb[:max_chars]
        if len(cb) > max_chars:
            tb += "\n[... truncated ...]"
        parts.append(tb)
    user_msg = "\n\n".join(parts) if parts else ""

    resp = httpx.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": "llama-3.3-70b-versatile",
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            "temperature": 0.4,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"].strip()
