import Editor, { loader } from "@monaco-editor/react";
import type { EditorProps } from "@monaco-editor/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });
export default function CodeEditor(props: EditorProps) {
  return <Editor {...props} />;
}
