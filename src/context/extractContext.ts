import * as vscode from "vscode";
import type { ExtractedContext } from "../types";

function findSymbolRange(
  symbols: vscode.DocumentSymbol[],
  pos: vscode.Position
): vscode.Range | undefined {
  for (const sym of symbols) {
    if (sym.range.contains(pos)) {
      const inner = findSymbolRange(sym.children ?? [], pos);
      return inner ?? sym.range;
    }
  }
  return undefined;
}

export async function extractContext(
  editor: vscode.TextEditor,
  maxSelectionChars: number,
  maxLinesNoSelection: number
): Promise<{ context: ExtractedContext; error?: string }> {
  const doc = editor.document;
  const selection = editor.selection;
  const hasSelection = !selection.isEmpty;

  if (editor.selections.length > 1) {
    return {
      context: emptyStub(doc),
      error: "CodeWhisper: multiple cursors are not supported yet. Use a single selection.",
    };
  }

  if (hasSelection) {
    let text = doc.getText(selection);
    let truncated = false;
    if (text.length > maxSelectionChars) {
      text = text.slice(0, maxSelectionChars);
      truncated = true;
    }
    return {
      context: {
        languageId: doc.languageId,
        fileLabel: vscode.workspace.asRelativePath(doc.uri, false),
        code: text,
        truncated,
        source: "selection",
      },
    };
  }

  const pos = selection.active;
  const syms = (await vscode.commands.executeCommand<
    vscode.DocumentSymbol[] | undefined
  >("vscode.executeDocumentSymbolProvider", doc.uri)) ?? [];

  const range = findSymbolRange(syms, pos);
  if (range) {
    let text = doc.getText(range);
    let truncated = false;
    if (text.length > maxSelectionChars) {
      text = text.slice(0, maxSelectionChars);
      truncated = true;
    }
    return {
      context: {
        languageId: doc.languageId,
        fileLabel: vscode.workspace.asRelativePath(doc.uri, false),
        code: text,
        truncated,
        source: "symbol",
      },
    };
  }

  const line = pos.line;
  const half = Math.floor(maxLinesNoSelection / 2);
  const startLine = Math.max(0, line - half);
  const endLine = Math.min(doc.lineCount - 1, line + half);
  const start = new vscode.Position(startLine, 0);
  const end = doc.lineAt(endLine).range.end;
  let text = doc.getText(new vscode.Range(start, end));
  let truncated = false;
  if (text.length > maxSelectionChars) {
    text = text.slice(0, maxSelectionChars);
    truncated = true;
  }
  return {
    context: {
      languageId: doc.languageId,
      fileLabel: vscode.workspace.asRelativePath(doc.uri, false),
      code: text,
      truncated,
      source: "lines",
    },
  };
}

function emptyStub(doc: vscode.TextDocument): ExtractedContext {
  return {
    languageId: doc.languageId,
    fileLabel: vscode.workspace.asRelativePath(doc.uri, false),
    code: "",
    truncated: false,
    source: "lines",
  };
}
