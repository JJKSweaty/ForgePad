"""Fast tests exercise validation, privacy, and Docker policy without executing code."""

import threading

import pytest
from forgepad.runner import DockerRunner, ProcessResult


def question(mode="stdio", compiler="gcc", language="c", sanitizers=False):
    return {
        "language": language,
        "test_config": {
            "mode": mode,
            "compiler": compiler,
            "sanitizers": sanitizers,
            "timeout_seconds": 2,
            "tests": [
                {
                    "id": "normal",
                    "name": "Example",
                    "visibility": "public",
                    "stdin": "7\n",
                    "expected_stdout": "14\n",
                    "category": "normal",
                },
                {
                    "id": "secret",
                    "name": "Secret: 9183",
                    "visibility": "hidden",
                    "stdin": "9183\n",
                    "expected_stdout": "18366\n",
                    "category": "boundary",
                },
            ],
        },
    }


@pytest.mark.parametrize(
    "filename", ["../bad.c", "/etc/passwd.c", "-fplugin=x.c", "a/b.c", "foo..c", "x.c\n", "a.c,readonly"]
)
def test_rejects_unsafe_filenames(filename):
    assert DockerRunner().run(question(), {filename: "int main(){}"})["status"] == "unsupported"


def test_source_limits_and_no_source():
    for files in ({"main.c": "x" * 262145}, {"one.h": ""}, {}):
        assert DockerRunner().run(question(), files)["status"] == "unsupported"


def test_unavailable_fails_closed(monkeypatch):
    monkeypatch.setattr(
        DockerRunner, "availability", lambda self: {"available": False, "detail": "Docker missing"}
    )
    result = DockerRunner().run(question(), {"main.c": "int main(){}"})
    assert result["status"] == "unavailable"
    assert result["tests"] == []


def test_cancel_before_compilation():
    event = threading.Event()
    event.set()
    assert (
        DockerRunner().run(question(), {"main.c": "int main(){}"}, cancel_event=event)["status"]
        == "cancelled"
    )


def test_legacy_hidden_cases_now_expose_compile_errors(monkeypatch):
    q = question(mode="fixture")
    q["test_config"]["tests"] = [q["test_config"]["tests"][1]]
    q["test_config"]["tests"][0]["fixture"] = "SECRET_FIXTURE_9183"
    monkeypatch.setattr(
        DockerRunner, "availability", lambda self: {"available": True, "image_id": "sha256:" + "a" * 64}
    )
    calls = []

    def fake(self, image, command, mounts, timeout, cancel, **kwargs):
        calls.append(command)
        return ProcessResult(0) if len(calls) == 1 else ProcessResult(1, stderr="SECRET_FIXTURE_9183")

    monkeypatch.setattr(DockerRunner, "_container", fake)
    result = DockerRunner().run(q, {"main.c": "int main(){}"}, include_hidden=True)
    assert result["status"] == "compilation_error"
    assert "SECRET_FIXTURE_9183" in str(result)
    assert result["tests"][0]["expected_stdout"] == "18366\n"
    assert result["tests"][0]["name"] == "Secret: 9183"
    assert result["tests"][0]["visibility"] == "public"
