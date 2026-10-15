"""Three original, explicitly specified exercises completing the native 16-question path."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def package(qid, title, prompt, constraints, starter, solution, cases, topics, notes):
    tests = []
    for i, (name, body, expected, category) in enumerate(cases):
        tests.append(
            {
                "id": f"case-{i + 1}",
                "name": name,
                "visibility": "public" if i < 3 else "hidden",
                "category": category,
                "stdin": "",
                "expected_stdout": expected,
                "fixture": '#include <stdint.h>\n#include <stdbool.h>\n#include <stdio.h>\n#include "exercise.h"\nint main(void) {\n'
                + body
                + "\n}\n",
            }
        )
    q = {
        "schema_version": "1.0",
        "id": qid,
        "version": 1,
        "title": title,
        "description": prompt.split("\n")[0],
        "type": "coding",
        "difficulty": "intermediate",
        "topics": topics,
        "duration_minutes": 30,
        "language": "c",
        "prompt": prompt,
        "constraints": constraints,
        "starter_files": {
            "exercise.h": starter,
            "exercise.c": '#include "exercise.h"\n/* Implement the declared function. */\n',
        },
        "reference_solution": {"exercise.h": starter, "exercise.c": '#include "exercise.h"\n' + solution},
        "test_config": {
            "mode": "fixture",
            "compiler": "clang",
            "sanitizers": True,
            "timeout_seconds": 2,
            "tests": tests,
        },
        "rubric": [
            "40: Implement all stated behavior correctly.",
            "25: Explain boundaries and safety.",
            "20: Justify a targeted test strategy.",
            "15: Explain firmware trade-offs and resource use.",
        ],
        "follow_ups": [
            "Which hardware or concurrency assumptions must be stated before deploying this code?",
            "How would you choose additional independently justified boundary tests?",
            "How would a constrained target change your implementation or verification strategy?",
        ],
        "hints": ["Write down the state invariants and boundary behavior before implementing."],
        "source": {"name": "ForgePad original", "url": "", "license": "MIT"},
        "solution_notes": notes,
        "time_complexity": "O(1)",
        "space_complexity": "O(1)",
    }
    (ROOT / "questions" / f"{qid}.json").write_text(json.dumps(q, indent=2) + "\n")


def main():
    cases = []
    for name, v, a, ok, out, category in [
        ("already aligned", 16, 8, 1, 16, "normal"),
        ("round upward", 17, 8, 1, 24, "normal"),
        ("zero", 0, 8, 1, 0, "boundary"),
        ("unit alignment", 4294967295, 1, 1, 4294967295, "boundary"),
        ("overflow", 4294967295, 8, 0, 123, "boundary"),
        ("zero alignment", 9, 0, 0, 123, "negative"),
        ("non power of two", 9, 3, 0, 123, "negative"),
        ("largest alignment", 1, 2147483648, 1, 2147483648, "boundary"),
    ]:
        cases.append(
            (
                name,
                f'uint32_t out=123; bool ok=align_up(UINT32_C({v}),UINT32_C({a}),&out); printf("%u %u\\n",(unsigned)ok,(unsigned)out);',
                f"{ok} {out}\n",
                category,
            )
        )
    package(
        "align-up",
        "Checked alignment for DMA buffers",
        "Round a 32-bit address upward to a power-of-two alignment.\nImplement bool align_up(uint32_t value, uint32_t alignment, uint32_t *out). Return true and store the smallest aligned uint32_t value >= value. If alignment is zero, is not a power of two, or the rounded result exceeds UINT32_MAX, return false without changing *out.",
        [
            "out is a valid non-null writable pointer.",
            "No allocation or hardware access. Single-threaded calls.",
            "All uint32_t values are in the input domain. Alignment is expressed in bytes.",
        ],
        "#include <stdint.h>\n#include <stdbool.h>\nbool align_up(uint32_t value,uint32_t alignment,uint32_t *out);\n",
        "bool align_up(uint32_t value,uint32_t alignment,uint32_t *out) {\n if(!alignment || (alignment & (alignment-1u))) return false;\n uint32_t mask=alignment-1u;\n if(value>UINT32_MAX-mask) return false;\n *out=(value+mask)&~mask; return true;\n}\n",
        cases,
        ["DMA", "integer arithmetic", "alignment"],
        "A power-of-two alignment has a mask of alignment-1. Check the addition bound first, then clear low bits. Expected values follow the smallest multiple definition; rejected calls preserve the sentinel.",
    )
    cases = []
    for name, v, out, category in [
        ("low bit", 1, 2147483648, "normal"),
        ("two bits", 3, 3221225472, "normal"),
        ("pattern", 305419896, 510274632, "normal"),
        ("zero", 0, 0, "boundary"),
        ("all bits", 4294967295, 4294967295, "boundary"),
        ("top bit", 2147483648, 1, "boundary"),
        ("alternating", 2863311530, 1431655765, "boundary"),
        ("middle boundary", 65536, 32768, "boundary"),
    ]:
        assert int(f"{v:032b}"[::-1], 2) == out
        cases.append((name, f'printf("%u\\n",(unsigned)reverse_bits(UINT32_C({v})));', f"{out}\n", category))
    package(
        "reverse-bits",
        "Reverse a 32-bit peripheral bit sequence",
        "Reverse exactly 32 bits of an unsigned value.\nImplement uint32_t reverse_bits(uint32_t value). Bit i of the input becomes bit 31-i of the result.",
        [
            "Every uint32_t value is valid.",
            "No target-specific instructions or compiler intrinsics.",
            "Single-threaded, no hardware access or allocation. Byte order in memory does not change the numeric contract.",
        ],
        "#include <stdint.h>\nuint32_t reverse_bits(uint32_t value);\n",
        "uint32_t reverse_bits(uint32_t value) {\n uint32_t result=0;\n for(unsigned i=0;i<32;i++) {result=(result<<1)|(value&1u);value>>=1;}\n return result;\n}\n",
        cases,
        ["bit operations", "registers", "embedded C"],
        "Shift an unsigned accumulator exactly 32 times, appending the least-significant input bit. Expected outputs are independently obtained by reversing the fixed-width 32-character binary representation.",
    )
    header = "#include <stdint.h>\n#include <stdbool.h>\ntypedef struct { bool stable; bool candidate; uint32_t since; } Debouncer;\nbool debounce_update(Debouncer *state,bool raw,uint32_t now,uint32_t delay);\n"
    cases = [
        (
            "rising edge",
            'Debouncer s={false,false,0}; debounce_update(&s,true,10,5); printf("%u\\n",(unsigned)debounce_update(&s,true,15,5));',
            "1\n",
            "normal",
        ),
        (
            "falling edge",
            'Debouncer s={true,true,0}; debounce_update(&s,false,10,5); printf("%u\\n",(unsigned)debounce_update(&s,false,15,5));',
            "0\n",
            "normal",
        ),
        (
            "not too early",
            'Debouncer s={false,false,0}; debounce_update(&s,true,10,5); printf("%u\\n",(unsigned)debounce_update(&s,true,14,5));',
            "0\n",
            "boundary",
        ),
        (
            "zero delay",
            'Debouncer s={false,false,0}; printf("%u\\n",(unsigned)debounce_update(&s,true,10,0));',
            "1\n",
            "boundary",
        ),
        (
            "bounce resets window",
            'Debouncer s={false,false,0}; debounce_update(&s,true,10,5); debounce_update(&s,false,12,5); debounce_update(&s,true,13,5); printf("%u\\n",(unsigned)debounce_update(&s,true,17,5));',
            "0\n",
            "boundary",
        ),
        (
            "rollover",
            'Debouncer s={false,false,0}; debounce_update(&s,true,UINT32_C(4294967293),5); printf("%u\\n",(unsigned)debounce_update(&s,true,2,5));',
            "1\n",
            "boundary",
        ),
        (
            "repeated timestamp",
            'Debouncer s={false,false,0}; debounce_update(&s,true,10,5); printf("%u\\n",(unsigned)debounce_update(&s,true,10,5));',
            "0\n",
            "boundary",
        ),
        (
            "stable unchanged",
            'Debouncer s={true,true,10}; printf("%u\\n",(unsigned)debounce_update(&s,true,11,5));',
            "1\n",
            "normal",
        ),
    ]
    package(
        "debounce-state",
        "Debounce a sampled digital input",
        "Implement a deterministic sampled-input debouncer.\nImplement bool debounce_update(Debouncer *state, bool raw, uint32_t now, uint32_t delay). On a change from state->candidate, set candidate=raw and since=now. On every call, if (uint32_t)(now-since) >= delay, set stable=candidate. Return stable. A zero delay applies a new candidate immediately.",
        [
            "state is a non-null writable pointer initialized with stable==candidate and since equal to its initial sampling time.",
            "Time is a modular uint32_t tick count. Calls occur in forward chronological order; elapsed time since the current candidate began is less than 2^31 ticks.",
            "delay < 2^31. Values outside these bounds are excluded, rather than assigned invented behavior.",
            "Single-threaded calls with no allocation. This sampled contract does not prove behavior between samples.",
        ],
        header,
        "bool debounce_update(Debouncer *s,bool raw,uint32_t now,uint32_t delay) {\n if(raw!=s->candidate){s->candidate=raw;s->since=now;}\n if((uint32_t)(now-s->since)>=delay) s->stable=s->candidate;\n return s->stable;\n}\n",
        cases,
        ["timers", "state machines", "wraparound"],
        "Track the last candidate transition and only accept it after the configured modular elapsed duration. Tests directly simulate the specified transition rules, including a five-tick interval across UINT32_MAX.",
    )


if __name__ == "__main__":
    main()
