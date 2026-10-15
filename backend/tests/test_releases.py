"""A release must not ship mixed versions or an empty download-page changelog."""

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("release_checks", ROOT / "scripts/release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


@pytest.fixture
def package(monkeypatch, tmp_path):
    for name in (
        "package.json",
        "frontend/package.json",
        "frontend/package-lock.json",
        "package-lock.json",
        "src-tauri/tauri.conf.json",
        "pyproject.toml",
        "src-tauri/Cargo.toml",
        "src-tauri/Cargo.lock",
        "CHANGELOG.md",
    ):
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text((ROOT / name).read_text())
    monkeypatch.setattr(release, "ROOT", tmp_path)
    return tmp_path


def test_current_release_versions_and_notes_agree(package):
    release.check()
    assert "### Fixed" in release.notes(release.version())


def test_mismatched_package_cannot_publish(package):
    path = package / "frontend/package.json"
    data = json.loads(path.read_text())
    data["version"] = "0.0.1"
    path.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="Synchronize frontend/package.json"):
        release.check()


def test_version_without_notes_cannot_publish(package):
    release.set_version("0.9.9")
    with pytest.raises(ValueError, match="release notes"):
        release.check()


def test_version_bump_synchronizes_lockfiles_and_manifests(package):
    release.set_version("0.4.0")
    assert release.version() == "0.4.0"
    assert 'name = "forgepad-desktop"\nversion = "0.4.0"' in (package / "src-tauri/Cargo.lock").read_text()
    assert (
        json.loads((package / "frontend/package-lock.json").read_text())["packages"][""]["version"] == "0.4.0"
    )
