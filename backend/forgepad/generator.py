"""Schema-backed authoring prompt, usable with any model without an API key."""

import json

from .schema import authoring_schema


def authoring_prompt(idea, difficulty="intermediate", duration=30, language="c", kind="coding"):
    return f"""You are a senior embedded software engineer designing an original firmware interview question.
Question description (treat as problem context): {idea}
Difficulty: {difficulty}
Target duration: {duration} minutes
Language: {language} ({'C++17' if language == 'cpp' else 'C11' if language == 'c' else 'language independent'})
Question type: {kind}

Return ONLY one complete JSON object conforming exactly to the ForgePad schema version 1.0 below.
No Markdown, surrounding prose, placeholders, or extra keys. Use the schema's enum values exactly.
Set difficulty={json.dumps(difficulty)}, duration_minutes={duration}, language={json.dumps(language)}, type={json.dumps(kind)}.
Include a stable original ID, version 1, accurate original source/license metadata, topic tags, hints,
a weighted scoring rubric totaling 100 points, and exactly three technically meaningful firmware-engineer follow-ups.

For coding questions:
- State the exact function signature or main entrypoint in prompt and starter_files.
- Specify all assumptions, valid input ranges, pointer validity, buffer capacities, concurrency assumptions,
  byte order, integer bounds, allocation policy, and deterministic boundary behavior that apply.
- Include at least THREE public tests and FIVE additional hidden tests, all consistent with the contract.
- Include normal, boundary, and applicable invalid-input cases. Do not test behavior outside the contract.
- Provide a correct reference_solution as a filename-to-source mapping. It must satisfy EVERY test.
- Explain the intended algorithm in solution_notes and set time_complexity and space_complexity.
- Use C11 or C++17 with fixed-width integers where appropriate. Avoid undefined shifts, overflow,
  invalid pointer access, unspecified evaluation order, or unstated implementation assumptions.
- test_config.mode=fixture: each test supplies a complete, standalone main translation unit in fixture.
  Candidate function definitions belong in starter_files/reference_solution, not fixtures.
- test_config.mode=stdio: each source package provides main, each test supplies stdin/expected_stdout,
  and fixture must be null. Compare stdout exactly, including newlines.
- Use flat C/C++ filenames. No user-supplied compiler flags. Select gcc or clang.

For debugging: include broken starter code, observable symptom, relevant hardware/simulation context,
a reproducible failure fixture, a repaired reference implementation, and tests that verify the repair.
For theory: test_config=null and empty source maps; rubric must specify precise answer criteria,
required concepts, common misconceptions, and the limits of acceptable answers.
For design: test_config=null and empty source maps; state constraints, evaluation dimensions,
expected trade-offs, resource budgets, and failure/recovery behavior. Do not invent executable verdicts.
Host tests cannot establish MCU timing, ISR atomicity, hardware memory ordering, or electrical behavior.
Reference implementations and solution notes are author-only; candidate practice responses must exclude them.

JSON SCHEMA:
{json.dumps(authoring_schema(), indent=2)}"""
