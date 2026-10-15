# Question package 1.0

`GET /api/schema` is the machine-readable JSON Schema generated from the same Pydantic model used by the importer. The complete original packages in `questions/` are working authoring examples.

Required fields include the stable `id`, integer `version`, title/description, type, difficulty, topic array, duration, language, prompt, rubric, and source/license metadata. `schema_version` is `1.0`. Increment `version` for a revision of the same question. A duplicate ID/version cannot be published; earlier versions remain available to historical attempts.

Types are `coding`, `theory`, `debugging`, `design`, and `code_review`. Languages are `c`, `cpp`, and `independent`. Difficulty is `beginner`, `intermediate`, `advanced`, or `expert`.

`starter_files` and `reference_solution` map safe flat filenames to source strings. C/C++ source and header files are supported, with at most 20 files and 256 KiB combined. Nested paths and compiler flags are not accepted. Explicit fixtures support pointer arguments, arrays, mutable outputs, test doubles, and custom setup/teardown in ordinary C/C++; automatic typed-signature harness generation is deferred.

Executable questions require a `test_config`:

```json
{
  "mode": "fixture",
  "compiler": "gcc",
  "sanitizers": false,
  "timeout_seconds": 2,
  "tests": [
    {
      "id": "ordinary",
      "name": "Normal register value",
      "visibility": "public",
      "category": "normal",
      "stdin": "",
      "expected_stdout": "3\n",
      "fixture": "#include <stdio.h>\nunsigned count_faults(unsigned);\nint main(void) { printf(\"%u\\n\", count_faults(7)); }\n"
    },
    {
      "id": "empty",
      "name": "No active faults",
      "visibility": "hidden",
      "category": "boundary",
      "stdin": "",
      "expected_stdout": "0\n",
      "fixture": "#include <stdio.h>\nunsigned count_faults(unsigned);\nint main(void) { printf(\"%u\\n\", count_faults(0)); }\n"
    }
  ]
}
```

`fixture` mode provides the test's main translation unit. `stdio` mode uses the submitted main and the test's standard input; omit `fixture`. Use `gcc` or `clang`. Tests require unique IDs, at least one public test, and representative normal and boundary categories. Add negative tests when invalid input is part of the contract. Categories document author intent; authors remain responsible for test quality. Compiler execution verifies expected outputs against the reference implementation, but cannot prove that the tests completely cover a problem.

Theory questions use `test_config: null`, empty source maps, and concrete rubric criteria. They never receive fabricated executable results.

## Publish workflow

1. Paste or upload a package. The generator prompt includes the live schema for external authoring tools.
2. Validate structure and compile/run the reference implementation in Docker against every executable test.
3. Inspect the rendered preview and validation result.
4. Confirm publication using the validation token.

Docker must be available to publish an executable package. A syntactically valid package or failed reference implementation does not receive a publish token. Authoring exports include full tests and solutions and should only be opened intentionally. Practice views omit reference solutions and hidden test data.
