import Editor, { loader } from "@monaco-editor/react";
import type { EditorProps } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/editor/editor.all";
import "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution";
import { completionEntries } from "./editorSupport";
import type { EditorDiagnostic } from "./editorSupport";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

for (const [name, base, background, foreground, comment, keyword, string] of [
  [
    "forgepad-dark",
    "vs-dark",
    "#1b1b1b",
    "#eeeeee",
    "#9b9b9b",
    "#a6bfd3",
    "#d2be96",
  ],
  [
    "forgepad-light",
    "vs",
    "#ffffff",
    "#242424",
    "#6b6b6b",
    "#355a7a",
    "#795b2f",
  ],
] as const) {
  monaco.editor.defineTheme(name, {
    base,
    inherit: true,
    rules: [
      { token: "", foreground: foreground.slice(1) },
      { token: "comment", foreground: comment.slice(1) },
      { token: "keyword", foreground: keyword.slice(1) },
      { token: "keyword.directive", foreground: keyword.slice(1) },
      { token: "type", foreground: base === "vs" ? "35675a" : "a7c8b4" },
      {
        token: "type.identifier",
        foreground: base === "vs" ? "35675a" : "a7c8b4",
      },
      { token: "number", foreground: base === "vs" ? "70577e" : "c7b796" },
      { token: "string", foreground: string.slice(1) },
    ],
    colors: {
      "editor.background": background,
      "editor.foreground": foreground,
      "editorGutter.background": background,
      "editorLineNumber.foreground": comment,
      "editorLineNumber.activeForeground": foreground,
      "editorBracketMatch.border": "#8a8a8a",
      "editorBracketHighlight.foreground1":
        base === "vs" ? "#666666" : "#cccccc",
      "editorBracketHighlight.foreground2":
        base === "vs" ? "#856a43" : "#d2be96",
      "editorBracketHighlight.foreground3":
        base === "vs" ? "#70577e" : "#c7b796",
      "editor.lineHighlightBackground": base === "vs" ? "#f5f5f5" : "#252525",
      "editor.selectionBackground": base === "vs" ? "#dedede" : "#444444",
    },
  });
}

type CodeEditorProps = EditorProps & {
  workspaceFiles?: Record<string, string>;
  diagnostics?: EditorDiagnostic[];
  revealPosition?: { lineNumber: number; column: number };
};
export default function CodeEditor({
  theme,
  options,
  workspaceFiles,
  diagnostics,
  revealPosition,
  onMount,
  ...props
}: CodeEditorProps) {
  const [instance, setInstance] =
    useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const workspace = useRef(workspaceFiles);
  workspace.current = workspaceFiles;
  useEffect(() => {
    if (!instance || !["c", "cpp"].includes(props.language ?? "")) return;
    const provider = monaco.languages.registerCompletionItemProvider(
      props.language!,
      {
        provideCompletionItems(model, position) {
          if (model !== instance.getModel()) return { suggestions: [] };
          const word = model.getWordUntilPosition(position);
          const range = new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn,
          );
          const kinds = monaco.languages.CompletionItemKind;
          const prefix = model
            .getLineContent(position.lineNumber)
            .slice(0, word.startColumn - 1)
            .trimEnd();
          const afterHash = prefix.endsWith("#");
          const afterStd = prefix.endsWith("std::");
          return {
            suggestions: completionEntries(
              model.getLanguageId(),
              workspace.current ?? { source: model.getValue() },
            )
              .filter(
                (entry) =>
                  entry.kind !== "variable" || entry.label !== word.word,
              )
              .map((entry) => ({
                ...entry,
                insertText:
                  entry.label === "include" && afterHash
                    ? entry.insertText.slice(1)
                    : afterStd && entry.label.startsWith("std::")
                      ? entry.insertText.slice(5)
                      : entry.insertText,
                filterText:
                  afterStd && entry.label.startsWith("std::")
                    ? entry.label.slice(5)
                    : entry.label,
                kind:
                  entry.kind === "keyword"
                    ? kinds.Keyword
                    : entry.kind === "snippet"
                      ? kinds.Snippet
                      : entry.kind === "function"
                        ? kinds.Function
                        : kinds.Variable,
                insertTextRules:
                  entry.kind === "snippet" || entry.kind === "function"
                    ? monaco.languages.CompletionItemInsertTextRule
                        .InsertAsSnippet
                    : undefined,
                range,
              })),
          };
        },
      },
    );
    return () => provider.dispose();
  }, [instance, props.language]);
  useEffect(() => {
    if (!instance) return;
    const apply = () => {
      const model = instance.getModel();
      if (!model) return;
      monaco.editor.setModelMarkers(
        model,
        "forgepad-run",
        (diagnostics ?? []).map((diagnostic) => {
          const position = model.validatePosition({
            lineNumber: diagnostic.line,
            column: diagnostic.column,
          });
          return {
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column + 1,
            message: diagnostic.message,
            severity:
              diagnostic.severity === "warning"
                ? monaco.MarkerSeverity.Warning
                : diagnostic.severity === "note"
                  ? monaco.MarkerSeverity.Info
                  : monaco.MarkerSeverity.Error,
          };
        }),
      );
    };
    apply();
    const listener = instance.onDidChangeModel(apply);
    return () => {
      listener.dispose();
      const model = instance.getModel();
      if (model) monaco.editor.setModelMarkers(model, "forgepad-run", []);
    };
  }, [instance, props.path, diagnostics]);
  useEffect(() => {
    if (!instance || !revealPosition) return;
    instance.setPosition(revealPosition);
    instance.revealPositionInCenter(revealPosition);
    instance.focus();
  }, [instance, props.path, revealPosition]);
  return (
    <Editor
      {...props}
      onMount={(editor, api) => {
        setInstance(editor);
        onMount?.(editor, api);
      }}
      theme={theme === "light" ? "forgepad-light" : "forgepad-dark"}
      options={{
        fontSize: 14,
        lineHeight: 22,
        fontFamily:
          '"SFMono-Regular", "Cascadia Code", Menlo, Consolas, monospace',
        minimap: { enabled: false },
        smoothScrolling: true,
        cursorSmoothCaretAnimation: "on",
        cursorBlinking: "smooth",
        renderLineHighlight: "all",
        lineNumbersMinChars: 3,
        glyphMargin: false,
        folding: true,
        showFoldingControls: "mouseover",
        guides: { indentation: true, bracketPairs: true },
        bracketPairColorization: { enabled: true },
        matchBrackets: "always",
        roundedSelection: true,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        quickSuggestions: { other: true, comments: false, strings: false },
        suggestOnTriggerCharacters: true,
        wordBasedSuggestions: "off",
        snippetSuggestions: "top",
        tabCompletion: "on",
        acceptSuggestionOnEnter: "smart",
        autoClosingBrackets: "languageDefined",
        autoClosingQuotes: "languageDefined",
        autoIndent: "full",
        formatOnPaste: false,
        padding: { top: 14, bottom: 14 },
        scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9 },
        ...options,
      }}
    />
  );
}
