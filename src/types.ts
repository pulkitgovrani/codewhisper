export interface ExplainResult {
  summary: string;
  complexity: string;
  suggestions: string[];
  warnings?: string;
}

export interface ExtractedContext {
  languageId: string;
  fileLabel: string;
  code: string;
  truncated: boolean;
  source: "selection" | "symbol" | "lines";
}
