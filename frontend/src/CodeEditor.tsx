import Editor, { loader } from "@monaco-editor/react";
import type { EditorProps } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/editor/editor.all";
import {
  language as cppLanguage,
  conf as cppConfiguration,
} from "monaco-editor/esm/vs/basic-languages/cpp/cpp.js";
import { completionEntries } from "./editorSupport";
import type { EditorDiagnostic } from "./editorSupport";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

// Extend Monaco's C/C++ grammar rather than coloring plain text. These lexical
// roles distinguish calls, fixed-width types and constants without claiming type checking.
const identifierRules: monaco.languages.IMonarchLanguageRule[] = [
  [
    /[a-zA-Z_]\w*(?=\s*\()/,
    {
      cases: { "@keywords": "keyword.$0", "@default": "entity.name.function" },
    },
  ],
  [
    /\b(?:u?int(?:8|16|32|64)_t|u?intptr_t|size_t|ptrdiff_t|[A-Za-z_]\w*_t)\b/,
    "type.identifier",
  ],
  [/[A-Z][A-Z0-9_]+\b/, "constant"],
  [
    /[a-zA-Z_]\w*/,
    {
      cases: {
        "@typeKeywords": "type",
        "@keywords": "keyword.$0",
        "@default": "identifier",
      },
    },
  ],
];
const cppTokens: monaco.languages.IMonarchLanguage = {
  ...cppLanguage,
  typeKeywords: [
    "void",
    "char",
    "short",
    "int",
    "long",
    "float",
    "double",
    "bool",
    "signed",
    "unsigned",
    "wchar_t",
    "char16_t",
    "char32_t",
  ],
  tokenizer: {
    ...cppLanguage.tokenizer,
    root: cppLanguage.tokenizer.root.flatMap((rule) =>
      Array.isArray(rule) &&
      rule[0] instanceof RegExp &&
      rule[0].source === "[a-zA-Z_]\\w*"
        ? identifierRules
        : [rule],
    ),
  },
};
for (const id of ["c", "cpp"]) {
  if (!monaco.languages.getLanguages().some((language) => language.id === id))
    monaco.languages.register({ id });
  monaco.languages.setLanguageConfiguration(id, cppConfiguration);
  monaco.languages.setMonarchTokensProvider(id, cppTokens);
}
for (const light of [false, true]) {
  const background = light ? "#ffffff" : "#181c24",
    foreground = light ? "#24292f" : "#d8dee9";
  monaco.editor.defineTheme(light ? "forgepad-light" : "forgepad-dark", {
    base: light ? "vs" : "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: foreground.slice(1) },
      { token: "identifier", foreground: light ? "005f99" : "9cdcfe" },
      {
        token: "comment",
        foreground: light ? "477039" : "86ad77",
        fontStyle: "italic",
      },
      { token: "keyword", foreground: light ? "7c329f" : "c792ea" },
      { token: "keyword.directive", foreground: light ? "225e9c" : "82aaff" },
      { token: "type", foreground: light ? "007d74" : "4ec9b0" },
      { token: "type.identifier", foreground: light ? "007d74" : "4ec9b0" },
      {
        token: "entity.name.function",
        foreground: light ? "795e26" : "ffd580",
      },
      { token: "constant", foreground: light ? "995115" : "f4b779" },
      { token: "number", foreground: light ? "116329" : "b5cea8" },
      { token: "string", foreground: light ? "a31515" : "ef9a78" },
      { token: "string.escape", foreground: light ? "8d357f" : "e8b7ed" },
      { token: "delimiter", foreground: light ? "46556a" : "b4c7df" },
    ],
    colors: {
      "editor.background": background,
      "editor.foreground": foreground,
      "editorGutter.background": background,
      "editorLineNumber.foreground": light ? "#65717e" : "#7c879b",
      "editorLineNumber.activeForeground": foreground,
      "editorBracketMatch.border": light ? "#6366b8" : "#a4a9ff",
      "editorBracketHighlight.foreground1": light ? "#906000" : "#ffd580",
      "editorBracketHighlight.foreground2": light ? "#9237a1" : "#c792ea",
      "editorBracketHighlight.foreground3": light ? "#006e9e" : "#80cbc4",
      "editorBracketHighlight.foreground4": light ? "#9c3a42" : "#f78c6c",
      "editorBracketHighlight.foreground5": light ? "#176a37" : "#addb67",
      "editorBracketHighlight.foreground6": light ? "#315dc0" : "#82aaff",
      "editor.lineHighlightBackground": light ? "#f1f5fa" : "#232b38",
      "editor.selectionBackground": light ? "#cce2ff" : "#385477",
      "editorCursor.foreground": light ? "#315dc0" : "#b4bdff",
      "editorIndentGuide.background1": light ? "#dce3ed" : "#303b4d",
      "editorIndentGuide.activeBackground1": light ? "#9cadd0" : "#6981aa",
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
