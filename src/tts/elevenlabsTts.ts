export async function synthesizeElevenLabs(params: {
  apiKey: string;
  voiceId: string;
  modelId: string;
  text: string;
  signal?: AbortSignal;
}): Promise<Uint8Array> {
  const id = params.voiceId.trim();
  if (!id) {
    throw new Error("ElevenLabs voice id is empty. Set codewhisper.elevenlabsVoiceId.");
  }
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": params.apiKey,
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: params.text,
      model_id: params.modelId,
    }),
    signal: params.signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS ${res.status}: ${errText.slice(0, 400)}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}
