import type { ExplainResult } from "../types";

export type DetailLevel = "brief" | "standard" | "deep";

export function buildSpeechText(result: ExplainResult, level: DetailLevel): string {
  const parts: string[] = [stripForSpeech(result.summary)];
  if (level === "standard" || level === "deep") {
    const c = stripForSpeech(result.complexity);
    if (c && c !== "-") {
      parts.push(`Complexity: ${c}`);
    }
  }
  if (level === "deep" && result.suggestions.length > 0) {
    parts.push(
      "Suggestions: " +
        result.suggestions.map((s) => stripForSpeech(s)).join("; ")
    );
  }
  if (result.warnings && (level === "deep" || level === "standard")) {
    parts.push(`Note: ${stripForSpeech(result.warnings)}`);
  }
  return parts.join(" ");
}

function stripForSpeech(s: string): string {
  return s.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
}
