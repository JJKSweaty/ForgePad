"""Versioned authoring contract and practice-safe projection."""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SAFE_FILENAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.(?:c|cpp|cc|h|hpp)$")
MAX_SOURCE_BYTES = 256 * 1024


def validate_files(files: dict[str, str]) -> dict[str, str]:
    if len(files) > 20:
        raise ValueError("At most 20 source files are supported")
    for name, content in files.items():
        if not SAFE_FILENAME.fullmatch(name) or ".." in name:
            raise ValueError(f"Unsafe source filename: {name!r}; use flat C/C++ filenames")
        if "\x00" in content:
            raise ValueError(f"NUL byte in source file {name}")
    if sum(len(value.encode()) for value in files.values()) > MAX_SOURCE_BYTES:
        raise ValueError("Combined source exceeds 256 KiB")
    return files


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Source(StrictModel):
    name: str = Field(min_length=1, max_length=200)
    url: str = Field(default="", max_length=2000)
    license: str = Field(min_length=1, max_length=200)


class TestCase(StrictModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,80}$")
    name: str = Field(min_length=1, max_length=200)
    visibility: Literal["public", "hidden"]
    stdin: str = Field(default="", max_length=65536)
    expected_stdout: str = Field(max_length=65536)
    fixture: str | None = Field(default=None, max_length=65536)
    category: Literal["normal", "boundary", "negative"]


class TestConfig(StrictModel):
    mode: Literal["stdio", "fixture"]
    compiler: Literal["gcc", "clang"] = "gcc"
    sanitizers: bool = False
    timeout_seconds: int = Field(default=2, ge=1, le=5)
    tests: list[TestCase] = Field(min_length=2, max_length=30)

    @model_validator(mode="after")
    def consistent(self):
        if len({t.id for t in self.tests}) != len(self.tests):
            raise ValueError("Test IDs must be unique")
        if not any(t.visibility == "public" for t in self.tests):
            raise ValueError("Provide at least one public test")
        if not {"normal", "boundary"}.issubset({t.category for t in self.tests}):
            raise ValueError("Provide representative normal and boundary tests")
        if self.mode == "fixture" and any(not t.fixture for t in self.tests):
            raise ValueError("Each fixture test requires an explicit C/C++ main fixture")
        if self.mode == "stdio" and any(t.fixture for t in self.tests):
            raise ValueError("stdio tests cannot also define a fixture")
        return self


class Question(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,79}$")
    version: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=2000)
    type: Literal["coding", "theory", "debugging", "design", "code_review"]
    difficulty: Literal["beginner", "intermediate", "advanced", "expert"]
    topics: list[str] = Field(min_length=1, max_length=30)
    duration_minutes: int = Field(ge=1, le=240)
    language: Literal["c", "cpp", "independent"]
    prompt: str = Field(min_length=1, max_length=30000)
    constraints: list[str] = Field(default_factory=list, max_length=30)
    starter_files: dict[str, str] = Field(default_factory=dict)
    test_config: TestConfig | None = None
    reference_solution: dict[str, str] = Field(default_factory=dict)
    rubric: list[str] = Field(min_length=1, max_length=30)
    follow_ups: list[str] = Field(default_factory=list, max_length=30)
    hints: list[str] = Field(default_factory=list, max_length=10)
    source: Source
    solution_notes: str = Field(default="", max_length=15000)
    time_complexity: str = Field(default="", max_length=1000)
    space_complexity: str = Field(default="", max_length=1000)

    _safe_files = field_validator("starter_files", "reference_solution")(validate_files)

    @field_validator("topics", "constraints", "rubric", "follow_ups", "hints")
    @classmethod
    def bounded_items(cls, items):
        if any(not item.strip() or len(item) > 4000 for item in items):
            raise ValueError("Text list items must contain 1–4000 characters")
        return items

    @model_validator(mode="after")
    def executable_contract(self):
        if self.type == "coding" and not self.test_config:
            raise ValueError("Coding questions require executable tests")
        if self.type in {"theory", "design"} and self.test_config:
            raise ValueError("Theory and design questions use rubric criteria, not executable tests")
        if self.test_config:
            if self.language == "independent" or not self.reference_solution or not self.starter_files:
                raise ValueError("Executable questions require C/C++, starter files, and reference solution")
            if not any(name.endswith((".c", ".cpp", ".cc")) for name in self.reference_solution):
                raise ValueError("Reference solution requires a compilable source file")
        return self


def practice_question(question: dict) -> dict:
    result = {key: value for key, value in question.items() if key not in {
        "reference_solution", "solution_notes", "time_complexity", "space_complexity"
    }}
    if result.get("test_config"):
        result["test_config"] = {
            **result["test_config"],
            "tests": [
                dict(test) for test in result["test_config"]["tests"] if test["visibility"] == "public"
            ],
        }
    return result


def authoring_errors(question: dict) -> list[str]:
    """New packages meet the complete interview contract; legacy seeds remain readable."""
    errors = []
    if not question.get("hints"):
        errors.append("Provide at least one technically useful hint")
    if len(question.get("follow_ups", [])) != 3:
        errors.append("Provide exactly three technical interview follow-ups")
    if question.get("test_config"):
        tests = question["test_config"]["tests"]
        if sum(t["visibility"] == "public" for t in tests) < 3:
            errors.append("Executable packages require at least three public tests")
        if sum(t["visibility"] == "hidden" for t in tests) < 5:
            errors.append("Executable packages require at least five additional hidden tests")
        for field in ("solution_notes", "time_complexity", "space_complexity"):
            if not question.get(field, "").strip():
                errors.append(f"Executable packages require {field}")
    return errors


def authoring_schema() -> dict:
    schema = Question.model_json_schema()
    schema["required"] += ["hints", "follow_ups"]
    schema["properties"]["hints"]["minItems"] = 1
    schema["properties"]["follow_ups"].update(minItems=3, maxItems=3)
    tests = schema["$defs"]["TestConfig"]["properties"]["tests"]
    tests["minItems"] = 8
    tests["allOf"] = [{"contains": {"properties": {"visibility": {"const": visibility}},
                                    "required": ["visibility"]}, "minContains": count}
                       for visibility, count in (("public", 3), ("hidden", 5))]
    schema["allOf"] = [{"if": {"properties": {"test_config": {"type": "object"}}, "required": ["test_config"]},
                        "then": {"required": ["solution_notes", "time_complexity", "space_complexity"],
                                 "properties": {key: {"minLength": 1} for key in (
                                     "solution_notes", "time_complexity", "space_complexity")}}}]
    return schema
