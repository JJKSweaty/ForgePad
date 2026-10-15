import Editor, { loader } from "@monaco-editor/react";
import type { EditorProps } from "@monaco-editor/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

monaco.editor.defineTheme("forgepad-monokai", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "", foreground: "F8F8F2" },
    { token: "comment", foreground: "888A7E", fontStyle: "italic" },
    { token: "keyword", foreground: "F92672" },
    { token: "keyword.directive", foreground: "F92672" },
    { token: "type", foreground: "66D9EF" },
    { token: "type.identifier", foreground: "66D9EF" },
    { token: "number", foreground: "AE81FF" },
    { token: "string", foreground: "E6DB74" },
    { token: "string.escape", foreground: "AE81FF" },
    { token: "identifier", foreground: "F8F8F2" },
    { token: "delimiter", foreground: "F8F8F2" },
  ],
  colors: {
    "editor.background": "#272822",
    "editor.foreground": "#F8F8F2",
    "editorLineNumber.foreground": "#77786D",
    "editorLineNumber.activeForeground": "#F8F8F2",
    "editor.lineHighlightBackground": "#30312B",
    "editor.selectionBackground": "#49483E",
    "editor.inactiveSelectionBackground": "#3E3D34",
    "editorCursor.foreground": "#F8F8F0",
    "editorIndentGuide.background1": "#3B3C35",
    "editorIndentGuide.activeBackground1": "#76786B",
    "editorBracketMatch.background": "#49483E",
    "editorBracketMatch.border": "#A6E22E",
    "editorWidget.background": "#20211C",
    "editorWidget.border": "#49483E",
    "editorGutter.background": "#272822",
  },
});

export default function CodeEditor({ theme, options, ...props }: EditorProps) {
  return (
    <Editor
      {...props}
      theme={theme === "light" ? "light" : "forgepad-monokai"}
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
