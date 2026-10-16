import { expect, it } from "vitest";
import { completionEntries, parseDiagnostics } from "./editorSupport";

it("extracts GCC and Clang locations without linking runner or hidden fixture files", () => {
  const error = "/workspace/main.c:12:8: error: expected ';'";
  expect(
    parseDiagnostics(
      [
        error,
        error,
        "\x1b[33m./buffer.h:4: warning: unused variable\x1b[0m",
        "main.c:6:2: note: declared here",
        "/tests/hidden.cpp:7:3: fatal error: private fixture",
        "Runner unavailable",
      ].join("\n"),
      { "main.c": "", "buffer.h": "" },
    ),
  ).toEqual([
    {
      file: "main.c",
      line: 12,
      column: 8,
      severity: "error",
      message: "expected ';'",
    },
    {
      file: "buffer.h",
      line: 4,
      column: 1,
      severity: "warning",
      message: "unused variable",
    },
    {
      file: "main.c",
      line: 6,
      column: 2,
      severity: "note",
      message: "declared here",
    },
  ]);
});

it("suggests C snippets and identifiers from unopened files, excluding comments and strings", () => {
  const entries = completionEntries("c", {
    "main.c": 'int buffer_count; // imaginary_name\nchar *s = "secret_string";',
    "buffer.h": "typedef unsigned long buffer_size_t;",
  });
  expect(entries).toContainEqual(
    expect.objectContaining({ label: "for", kind: "snippet" }),
  );
  expect(entries).toContainEqual(
    expect.objectContaining({ label: "printf", kind: "function" }),
  );
  expect(entries).toContainEqual(
    expect.objectContaining({
      label: "buffer_size_t",
      detail: "Identifier · buffer.h",
    }),
  );
  expect(
    entries.some((entry) =>
      ["imaginary_name", "secret_string", "namespace"].includes(entry.label),
    ),
  ).toBe(false);
  expect(completionEntries("cpp", {})).toContainEqual(
    expect.objectContaining({ label: "std::vector" }),
  );
  expect(completionEntries("cpp", {})).toContainEqual(
    expect.objectContaining({ label: "nullptr", kind: "keyword" }),
  );
});
