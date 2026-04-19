import * as vscode from "vscode";

export type ContextMode = "fullFile" | "selection" | "visibleRange" | "selectionSurrounding";

export interface BuiltContext {
  /** Full formatted block appended after the user question for the LLM. */
  contextBody: string;
  /** Region to highlight in the editor after a successful ask. */
  highlightRange: vscode.Range | null;
  workspaceRelativePath: string;
  languageId: string;
}

function lineCol(p: vscode.Position, oneBasedLine: boolean): string {
  const line = oneBasedLine ? p.line + 1 : p.line;
  return `L${line}:${p.character}`;
}

/** Merge visible ranges into one range covering all visible lines. */
function visibleRangeUnion(editor: vscode.TextEditor): vscode.Range {
  const vr = editor.visibleRanges;
  if (vr.length === 0) {
    return new vscode.Range(0, 0, 0, 0);
  }
  let start = vr[0].start;
  let end = vr[0].end;
  for (let i = 1; i < vr.length; i++) {
    if (vr[i].start.isBefore(start)) start = vr[i].start;
    if (vr[i].end.isAfter(end)) end = vr[i].end;
  }
  return new vscode.Range(start, end);
}

function clampRangeToDoc(doc: vscode.TextDocument, r: vscode.Range): vscode.Range {
  const s = doc.validatePosition(r.start);
  const e = doc.validatePosition(r.end);
  return new vscode.Range(s, e);
}

function expandSurrounding(
  doc: vscode.TextDocument,
  sel: vscode.Selection,
  pad: number
): vscode.Range {
  const startLine = Math.max(0, sel.start.line - pad);
  const endLine = Math.min(doc.lineCount - 1, sel.end.line + pad);
  const start = new vscode.Position(startLine, 0);
  const end = doc.lineAt(endLine).rangeIncludingLineBreak.end;
  return clampRangeToDoc(doc, new vscode.Range(start, end));
}

/**
 * Smart truncate: prefer keeping `core` intact; trim `prefix` and `suffix` strings
 * (each may be empty) until total length fits.
 */
export function smartTruncateParts(
  header: string,
  prefix: string,
  core: string,
  suffix: string,
  maxTotal: number
): string {
  const overhead = header.length;
  if (overhead >= maxTotal) {
    return header.slice(0, maxTotal) + "\n[... truncated ...]";
  }
  let budget = maxTotal - overhead;
  const marker = "\n[... truncated ...]";
  const tryJoin = (p: string, c: string, s: string) => p + c + s;

  let p = prefix;
  let c = core;
  let suf = suffix;
  let body = tryJoin(p, c, suf);
  if (body.length <= budget) {
    return header + body;
  }

  // Trim suffix first, then prefix, then core as last resort
  while (body.length > budget && (p.length > 0 || suf.length > 0)) {
    if (suf.length > 0) {
      suf = suf.slice(0, Math.max(0, suf.length - Math.max(1, Math.floor(suf.length * 0.2))));
    } else if (p.length > 0) {
      p = p.slice(Math.min(p.length, Math.max(1, Math.floor(p.length * 0.2))));
    } else {
      break;
    }
    body = tryJoin(p, c, suf);
  }
  if (body.length <= budget) {
    return header + body;
  }

  // Trim core from middle outward (keep start/end of selection)
  if (c.length > budget - marker.length) {
    const keep = Math.max(0, budget - marker.length - p.length - suf.length);
    if (keep < c.length) {
      const headLen = Math.floor(keep / 2);
      const tailLen = keep - headLen;
      c = c.slice(0, headLen) + marker + c.slice(c.length - tailLen);
    }
  }
  body = tryJoin(p, c, suf);
  while (body.length > budget && p.length > 0) {
    p = p.slice(Math.min(p.length, Math.max(1, Math.floor(p.length * 0.15))));
    body = tryJoin(p, c, suf);
  }
  while (body.length > budget && suf.length > 0) {
    suf = suf.slice(0, Math.max(0, suf.length - Math.max(1, Math.floor(suf.length * 0.15))));
    body = tryJoin(p, c, suf);
  }
  if (body.length > budget) {
    c = c.slice(0, Math.max(0, budget - p.length - suf.length - marker.length)) + marker;
    body = tryJoin(p, c, suf);
  }
  return header + body;
}

export function buildEditorContext(
  editor: vscode.TextEditor | undefined,
  mode: ContextMode,
  surroundLines: number,
  maxChars: number
): BuiltContext {
  if (!editor) {
    return {
      contextBody: "",
      highlightRange: null,
      workspaceRelativePath: "",
      languageId: "",
    };
  }

  const doc = editor.document;
  const ws = vscode.workspace.getWorkspaceFolder(doc.uri);
  const workspaceRelativePath = ws ? vscode.workspace.asRelativePath(doc.uri, false) : doc.fileName;
  const languageId = doc.languageId;
  const lineCount = doc.lineCount;
  const sel = editor.selection;
  const hasSel = !sel.isEmpty;

  let sourceRange: vscode.Range;
  let label: string;

  switch (mode) {
    case "selection":
      if (hasSel) {
        sourceRange = sel;
        label = `Selection ${lineCol(sel.start, true)}–${lineCol(sel.end, true)}`;
      } else {
        sourceRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
        label = `Full file (no selection)`;
      }
      break;
    case "visibleRange":
      sourceRange = visibleRangeUnion(editor);
      label = `Visible editor range ${lineCol(sourceRange.start, true)}–${lineCol(sourceRange.end, true)}`;
      break;
    case "selectionSurrounding":
      if (hasSel) {
        sourceRange = expandSurrounding(doc, sel, surroundLines);
        label = `Selection ±${surroundLines} lines ${lineCol(sourceRange.start, true)}–${lineCol(sourceRange.end, true)}`;
      } else {
        sourceRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
        label = `Full file (no selection)`;
      }
      break;
    case "fullFile":
    default:
      sourceRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
      label = `Full file`;
      break;
  }

  sourceRange = clampRangeToDoc(doc, sourceRange);
  const fullText = doc.getText();

  let prefix = "";
  let core = "";
  let suffix = "";

  if (mode === "selectionSurrounding" && hasSel) {
    const exp = sourceRange;
    const expStartOff = doc.offsetAt(exp.start);
    const expEndOff = doc.offsetAt(exp.end);
    const selStartOff = doc.offsetAt(sel.start);
    const selEndOff = doc.offsetAt(sel.end);
    prefix = fullText.slice(expStartOff, selStartOff);
    core = fullText.slice(selStartOff, selEndOff);
    suffix = fullText.slice(selEndOff, expEndOff);
  } else {
    core = doc.getText(sourceRange);
  }

  const header =
    `File: ${workspaceRelativePath}\n` +
    `Language: ${languageId}\n` +
    `Lines in file: ${lineCount}\n` +
    `Context: ${label}\n` +
    `Code:\n`;

  const contextBody =
    mode === "selectionSurrounding" && hasSel
      ? smartTruncateParts(header, prefix, core, suffix, maxChars)
      : (() => {
          const block = header + core;
          if (block.length <= maxChars) return block;
          return block.slice(0, maxChars) + "\n[... truncated ...]";
        })();

  const highlightRange = sourceRange;

  return {
    contextBody,
    highlightRange,
    workspaceRelativePath,
    languageId,
  };
}
