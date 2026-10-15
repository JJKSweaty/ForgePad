import Editor, { loader } from "@monaco-editor/react";
import type { EditorProps } from "@monaco-editor/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

for (const [name, base, background, foreground, comment, keyword, string] of [
  [
    "forgepad-dark",
    "vs-dark",
    "#20273c",
    "#f0f3ff",
    "#9daac6",
    "#c7acff",
    "#f4c58b",
  ],
  [
    "forgepad-light",
    "vs",
    "#ffffff",
    "#27334e",
    "#687995",
    "#7248b5",
    "#9c4a29",
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
      { token: "type", foreground: base === "vs" ? "3759ba" : "9ebaff" },
      {
        token: "type.identifier",
        foreground: base === "vs" ? "3759ba" : "9ebaff",
      },
      { token: "number", foreground: base === "vs" ? "8054a2" : "d7b2ff" },
      { token: "string", foreground: string.slice(1) },
    ],
    colors: {
      "editor.background": background,
      "editor.foreground": foreground,
      "editorGutter.background": background,
      "editorLineNumber.foreground": comment,
      "editorLineNumber.activeForeground": foreground,
      "editorBracketMatch.border": "#8498f5",
      "editorBracketHighlight.foreground1":
        base === "vs" ? "#495bd5" : "#a9baff",
      "editorBracketHighlight.foreground2":
        base === "vs" ? "#945a29" : "#f4c58b",
      "editorBracketHighlight.foreground3":
        base === "vs" ? "#8648a6" : "#d7b2ff",
      "editor.lineHighlightBackground": base === "vs" ? "#f4f6fd" : "#29324a",
      "editor.selectionBackground": base === "vs" ? "#dce3ff" : "#404e7c",
    },
  });
}

export default function CodeEditor({ theme, options, ...props }: EditorProps) {
  return (
    <Editor
      {...props}
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
        padding: { top: 14, bottom: 14 },
        scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9 },
        ...options,
      }}
    />
  );
}
