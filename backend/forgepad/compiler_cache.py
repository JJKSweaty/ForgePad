"""Content-addressed executable cache. Verdicts are never cached."""

import hashlib
import json
import os
import shutil
import stat
import tempfile
from pathlib import Path

MAX_BINARY = 16 * 1024 * 1024


def cache_key(question, files, image_id, compiler, flags, include_hidden=False):
    context = {
        "format": 1,
        "include_hidden": include_hidden,
        "language": question["language"],
        "tests": question["test_config"],
        "files": files,
        "image": image_id,
        "compiler": compiler,
        "flags": flags,
        "environment": {key: os.getenv(key, "") for key in ("DOCKER_CONTEXT", "DOCKER_DEFAULT_PLATFORM")},
    }
    return hashlib.sha256(json.dumps(context, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def bounded_binary(path):
    try:
        info = path.lstat()
        return stat.S_ISREG(info.st_mode) and 0 < info.st_size <= MAX_BINARY
    except OSError:
        return False


class CompilerCache:
    def __init__(self, directory, key):
        self.directory = Path(directory) if directory else None
        self.path = self.directory / key if self.directory else None
        self.manifest = {}
        if self.path:
            try:
                raw = self.path / "manifest.json"
                if raw.is_file() and not raw.is_symlink() and raw.stat().st_size < 8192:
                    value = json.loads(raw.read_text())
                    if isinstance(value, dict):
                        self.manifest = value
            except (OSError, ValueError):
                pass

    def restore(self, index, destination):
        if not self.path:
            return False
        name = f"{index}.bin"
        source = self.path / name
        try:
            if not bounded_binary(source):
                return False
            if hashlib.sha256(source.read_bytes()).hexdigest() != self.manifest.get(name):
                return False
            shutil.copyfile(source, destination)
            destination.chmod(0o555)
            return True
        except OSError:
            return False

    def publish(self, binaries):
        if not self.path or not binaries:
            return
        try:
            self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            with tempfile.TemporaryDirectory(prefix=".building-", dir=self.directory) as staging:
                stage = Path(staging)
                manifest = {}
                for index, binary in binaries.items():
                    if not bounded_binary(binary):
                        return
                    name = f"{index}.bin"
                    target = stage / name
                    shutil.copyfile(binary, target)
                    target.chmod(0o555)
                    manifest[name] = hashlib.sha256(target.read_bytes()).hexdigest()
                (stage / "manifest.json").write_text(json.dumps(manifest, sort_keys=True))
                # Same-key workers may race; keep the already committed immutable artifact set.
                if not self.path.exists():
                    try:
                        stage.rename(self.path)
                        stage.mkdir()
                    except FileExistsError:
                        pass
        except OSError:
            pass  # Cache failures never prevent fresh sandbox compilation or execution.
