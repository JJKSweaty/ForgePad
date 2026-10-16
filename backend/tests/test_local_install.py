"""App cleanup must leave other apps, newer builds, and user data untouched."""
import importlib.util
import plistlib
from pathlib import Path

spec = importlib.util.spec_from_file_location("local_install", Path(__file__).resolve().parents[2] / "scripts/install_local.py")
install = importlib.util.module_from_spec(spec)
spec.loader.exec_module(install)


def bundle(root, name, version="0.3.2", identifier=install.BUNDLE_ID):
    app = root / name
    info = app / "Contents/Info.plist"
    info.parent.mkdir(parents=True)
    info.write_bytes(plistlib.dumps({"CFBundleIdentifier": identifier, "CFBundleShortVersionString": version}))
    return app


def test_cleanup_only_selects_verified_older_or_duplicate_forgepad_apps(tmp_path):
    current = bundle(tmp_path, "ForgePad.app")
    old = bundle(tmp_path, "ForgePad Old.app", "0.3.0")
    duplicate = bundle(tmp_path, "ForgePad QA.app")
    bundle(tmp_path, "ForgePad Future.app", "0.4.0")
    bundle(tmp_path, "Other.app", "0.1.0", "com.example.other")
    data = tmp_path / "drafts.json"
    data.write_text("keep my progress")
    assert set(install.cleanup_candidates([tmp_path], current, "0.3.2")) == {old, duplicate}
    assert data.read_text() == "keep my progress"


def test_symlinked_bundles_are_not_removed_and_trash_names_do_not_collide(tmp_path):
    old = bundle(tmp_path, "ForgePad.app", "0.3.0")
    (tmp_path / "ForgePad shortcut.app").symlink_to(old, target_is_directory=True)
    assert list(install.find_bundles([tmp_path])) == [old]
    trash = tmp_path / "Trash"
    moved = install.move_to_trash(old, trash)
    assert moved.is_dir() and not old.exists()
    replacement = bundle(tmp_path, "ForgePad.app", "0.3.0")
    assert install.move_to_trash(replacement, trash) != moved
