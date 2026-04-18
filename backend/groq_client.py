import httpx

SYSTEM_PROMPT = (
    "You are a coding buddy. "
    "Answer in 2-3 plain spoken sentences. "
    "No markdown, no bullet points, no code blocks."
)


def ask(transcript: str, code: str, filename: str, api_key: str) -> str:
    user_msg = transcript
    if code.strip():
        label = filename or "current file"
        user_msg += f"\n\nCode context ({label}):\n{code[:8000]}"

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
