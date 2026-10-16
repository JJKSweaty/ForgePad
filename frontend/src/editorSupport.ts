export type EditorDiagnostic = {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "note";
  message: string;
};

/** GCC/Clang diagnostics are only linked when they refer to a user's source file. */
export function parseDiagnostics(
  output: string,
  files: Record<string, string>,
) {
  const diagnostics: EditorDiagnostic[] = [];
  const seen = new Set<string>();
  for (const line of output.replace(/\x1b\[[0-9;]*m/g, "").split("\n")) {
    const match = line.match(
      /^(.+?\.(?:c|cc|cpp|h|hpp)):(\d+)(?::(\d+))?:\s*(fatal error|runtime error|error|warning|note):\s*(.+)$/,
    );
    if (!match) continue;
    const file = match[1].replace(/\\/g, "/").split("/").pop()!;
    if (!(file in files)) continue;
    const diagnostic: EditorDiagnostic = {
      file,
      line: Math.max(1, Number(match[2])),
      column: Math.max(1, Number(match[3] ?? 1)),
      severity:
        match[4] === "warning"
          ? "warning"
          : match[4] === "note"
            ? "note"
            : "error",
      message: match[5],
    };
    const key = JSON.stringify(diagnostic);
    if (!seen.has(key)) diagnostics.push(diagnostic);
    seen.add(key);
  }
  return diagnostics;
}

type CompletionEntry = {
  label: string;
  insertText: string;
  kind: "keyword" | "snippet" | "function" | "variable";
  detail: string;
};
const cKeywords =
  "auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Bool bool true false NULL size_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t";
const cppKeywords =
  "alignas alignof class constexpr decltype delete explicit false friend namespace new noexcept nullptr operator override private protected public reference static_assert template this throw true try typename using virtual";
const snippets: [string, string, string][] = [
  [
    "for",
    "for (size_t ${1:i} = 0; ${1:i} < ${2:count}; ++${1:i}) {\n\t$0\n}",
    "For loop",
  ],
  ["if", "if (${1:condition}) {\n\t$0\n}", "If statement"],
  ["while", "while (${1:condition}) {\n\t$0\n}", "While loop"],
  [
    "switch",
    "switch (${1:value}) {\n\tcase ${2:0}:\n\t\t$0\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}",
    "Switch statement",
  ],
  ["struct", "struct ${1:Name} {\n\t$0\n};", "Struct definition"],
  ["main", "int main(void) {\n\t$0\n\treturn 0;\n}", "Program entry point"],
  ["include", "#include <${1:stdio.h}>$0", "Include header"],
];
const functions: [string, string, string][] = [
  [
    "printf",
    'printf("${1:%s}\\n", ${2:value})$0',
    "stdio.h · formatted output",
  ],
  [
    "fprintf",
    'fprintf(${1:stderr}, "${2:%s}\\n", ${3:value})$0',
    "stdio.h · formatted stream output",
  ],
  [
    "malloc",
    "malloc(${1:count} * sizeof(${2:int}))$0",
    "stdlib.h · allocate memory",
  ],
  [
    "calloc",
    "calloc(${1:count}, sizeof(${2:int}))$0",
    "stdlib.h · zero-initialized allocation",
  ],
  ["free", "free(${1:ptr})$0", "stdlib.h · release memory"],
  [
    "memcpy",
    "memcpy(${1:dest}, ${2:src}, ${3:size})$0",
    "string.h · copy bytes",
  ],
  ["memset", "memset(${1:dest}, ${2:0}, ${3:size})$0", "string.h · fill bytes"],
  ["strlen", "strlen(${1:str})$0", "string.h · string length"],
  ["strcmp", "strcmp(${1:left}, ${2:right})$0", "string.h · compare strings"],
];

/** Local suggestions, including identifiers from unopened files in this draft. */
export function completionEntries(
  language: string,
  files: Record<string, string>,
): CompletionEntry[] {
  const keywords = new Set(
    `${cKeywords} ${language === "cpp" ? cppKeywords : ""}`.trim().split(/\s+/),
  );
  const entries: CompletionEntry[] = [...keywords].map((label) => ({
    label,
    insertText: label,
    kind: "keyword",
    detail: language === "cpp" ? "C++" : "C",
  }));
  for (const [label, insertText, detail] of snippets)
    entries.push({ label, insertText, detail, kind: "snippet" });
  for (const [label, insertText, detail] of functions)
    entries.push({ label, insertText, detail, kind: "function" });
  if (language === "cpp") {
    entries.push(
      {
        label: "std::vector",
        insertText: "std::vector<${1:int}> ${2:values};$0",
        kind: "snippet",
        detail: "vector · dynamic array",
      },
      {
        label: "std::cout",
        insertText: "std::cout << ${1:value} << '\\n';$0",
        kind: "snippet",
        detail: "iostream · stream output",
      },
      {
        label: "class",
        insertText: "class ${1:Name} {\npublic:\n\t$0\n};",
        kind: "snippet",
        detail: "Class definition",
      },
    );
  }
  const identifiers = new Set(entries.map((entry) => entry.label));
  for (const [file, code] of Object.entries(files)) {
    // Ignore prose in comments and strings; keep suggestions limited on large drafts.
    const source = code.replace(
      /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
      " ",
    );
    for (const match of source.matchAll(/\b[A-Za-z_]\w*\b/g)) {
      const label = match[0];
      if (identifiers.has(label) || label.length < 2) continue;
      identifiers.add(label);
      entries.push({
        label,
        insertText: label,
        kind: "variable",
        detail: `Identifier · ${file}`,
      });
      if (identifiers.size >= 1000) return entries;
    }
  }
  return entries;
}
