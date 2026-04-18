import type { ExplainResult } from "../types";

export function parseExplainJson(raw: string): ExplainResult {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error("Model did not return valid JSON.");
  }
  if (!obj || typeof obj !== "object") {
    throw new Error("Invalid JSON shape.");
  }
  const r = obj as Record<string, unknown>;
  const summary = typeof r.summary === "string" ? r.summary : "";
  const complexity = typeof r.complexity === "string" ? r.complexity : "";
  let suggestions: string[] = [];
  if (Array.isArray(r.suggestions)) {
    suggestions = r.suggestions.filter((x): x is string => typeof x === "string");
  }
  const warnings =
    typeof r.warnings === "string" && r.warnings.length > 0 ? r.warnings : undefined;
  if (!summary) {
    throw new Error("JSON missing summary.");
  }
  return { summary, complexity, suggestions, warnings };
}
