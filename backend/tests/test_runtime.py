"""Runtime recovery must keep explicit connections and other VMs untouched."""

import os
from subprocess import CompletedProcess
from unittest.mock import Mock

import pytest
from forgepad import runtime


@pytest.fixture
def environment(monkeypatch, tmp_path):
    monkeypatch.setenv("DOCKER_CONTEXT", "")
    monkeypatch.setenv("FORGEPAD_RUNNER_TMPDIR", str(tmp_path / "jobs"))
    monkeypatch.setattr(runtime.shutil, "which", lambda _: "/tools/bin")
    monkeypatch.setattr(runtime.Path, "home", lambda: tmp_path)
    calls = []

    def command(*args, **kwargs):
        calls.append(args)
        return CompletedProcess(args, 0, stdout="default\n", stderr="")

    monkeypatch.setattr(runtime, "command", command)
    return calls


def test_discovers_working_context_and_verifies_execution(environment):
    runner = Mock(image="forgepad-runner:local")
    runner.availability.side_effect = lambda: {"available": os.environ["DOCKER_CONTEXT"] == runtime.CONTEXT}
    preflight = Mock(return_value={"status": "passed"})
    result = runtime.prepare(runner, preflight)
    assert result["config"]["docker_context"] == runtime.CONTEXT
    preflight.assert_called_once()
    assert not any(c[0] == "colima" for c in environment)


def test_explicit_connection_does_not_switch_or_restart_other_vm(environment, monkeypatch):
    monkeypatch.setenv("DOCKER_CONTEXT", "colima-other-project")
    runner = Mock(image="custom", availability=Mock(return_value={"available": False}))
    with pytest.raises(ValueError, match="Runner needs setup"):
        runtime.prepare(runner, Mock(), setup=False)
    assert os.environ["DOCKER_CONTEXT"] == "colima-other-project"
    assert not any(c[0] == "colima" for c in environment)


def test_image_alone_is_not_a_ready_runner(environment):
    runner = Mock(image="local", availability=Mock(return_value={"available": True}))
    with pytest.raises(ValueError, match="Runner needs setup"):
        runtime.prepare(runner, Mock(return_value={"status": "runtime_error"}))


def test_missing_docker_has_actionable_setup_error(environment, monkeypatch):
    monkeypatch.setattr(runtime.shutil, "which", lambda _: None)
    with pytest.raises(ValueError, match="brew install docker colima"):
        runtime.prepare(Mock(), Mock())


def test_stopped_managed_vm_recovers_without_global_context_changes(environment, monkeypatch):
    monkeypatch.setenv("DOCKER_CONTEXT", runtime.CONTEXT)
    runner = Mock(image="local")
    runner.availability.side_effect = [{"available": False}, {"available": True}]
    real_command = runtime.command

    def command(*args, **kwargs):
        if args[:2] == ("colima", "status"):
            return CompletedProcess(args, 1, stdout="", stderr="stopped")
        return real_command(*args, **kwargs)

    monkeypatch.setattr(runtime, "command", command)
    result = runtime.prepare(runner, Mock(return_value={"status": "passed"}))
    assert result["available"]
    assert ("colima", "start", "--profile", "forgepad", "--activate=false") in environment
    assert not any(c[:3] == ("docker", "context", "use") for c in environment)


def test_setup_repairs_only_managed_mount(environment, monkeypatch):
    monkeypatch.setenv("DOCKER_CONTEXT", runtime.CONTEXT)
    runner = Mock(image="local", availability=Mock(return_value={"available": True}))
    preflight = Mock(side_effect=[{"status": "runtime_error"}, {"status": "passed"}])
    result = runtime.prepare(runner, preflight, setup=True)
    assert result["available"]
    start = next(c for c in environment if c[:2] == ("colima", "start"))
    assert "--mount" in start and start[-1].endswith("/jobs:w")
    assert ("colima", "stop", "--profile", "forgepad") in environment
