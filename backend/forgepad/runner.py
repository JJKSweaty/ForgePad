"""Docker-only C/C++ execution. Verdicts and expected output remain on the host."""
from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

OUTPUT_LIMIT = 64 * 1024
SOURCE_LIMIT = 512 * 1024
SAFE_FILE = re.compile(r"[A-Za-z_][A-Za-z0-9_.-]{0,79}\.(?:c|cc|cpp|h|hpp)\Z")
SOURCE_EXTENSIONS = {".c", ".cc", ".cpp"}


@dataclass
class ProcessResult:
    returncode: int
    stdout: str = ""
    stderr: str = ""
    timeout: bool = False
    cancelled: bool = False
    overflow: bool = False
    oom: bool = False


class DockerRunner:
    def __init__(self, image: str | None = None):
        self.image = image or os.getenv("FORGEPAD_RUNNER_IMAGE", "forgepad-runner:local")

    def availability(self) -> dict:
        if not shutil.which("docker"):
            return {"available": False, "detail": "Docker CLI is missing. Install Docker and build the runner image."}
        try:
            result = subprocess.run(
                ["docker", "image", "inspect", "--format", "{{.Id}}", self.image],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode or not re.fullmatch(r"sha256:[0-9a-f]{64}", result.stdout.strip()):
                return {"available": False, "detail": "Docker is unavailable or the runner image is missing. Start Docker and run: docker build -t forgepad-runner:local sandbox"}
            return {"available": True, "detail": "Docker runner ready", "image_id": result.stdout.strip()}
        except (OSError, subprocess.TimeoutExpired):
            return {"available": False, "detail": "Docker did not respond. Check the Docker daemon and selected context."}

    @staticmethod
    def _remove(name: str) -> None:
        try:
            subprocess.run(["docker", "rm", "--force", name], capture_output=True, timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            pass  # CPU/memory/PID limits remain enforced by the daemon.

    def _container(self, image: str, command: list[str], mounts: list[tuple[Path, str, bool]],
                   timeout: float, cancel: threading.Event, stdin: str = "", compile_job: bool = False) -> ProcessResult:
        name = f"forgepad-{uuid.uuid4().hex}"
        args = ["docker", "run", "--pull=never", "--name", name, "--network=none", "--read-only",
                "--cap-drop=ALL", "--security-opt=no-new-privileges", "--user=65534:65534",
                "--pids-limit=32", "--cpus=1", "--memory=256m", "--memory-swap=256m",
                "--ulimit", f"cpu={25 if compile_job else 6}:{25 if compile_job else 6}",
                "--ulimit", "fsize=16777216:16777216", "--ulimit", "nofile=64:64",
                "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=32m,mode=1777",
                "--workdir", "/build" if compile_job else "/work", "--interactive",
                "--env", "ASAN_OPTIONS=detect_leaks=0:abort_on_error=1",
                "--env", "UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1"]
        for source, target, readonly in mounts:
            args += ["--mount", f"type=bind,src={source},dst={target}" + (",readonly" if readonly else "")]
        args += [image, *command]
        proc = None
        buffers = [bytearray(), bytearray()]
        overflow = threading.Event()
        readers: list[threading.Thread] = []
        result = ProcessResult(-1)
        start = time.monotonic()
        try:
            if cancel.is_set():
                return ProcessResult(-1, cancelled=True)
            proc = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

            def drain(stream, buffer):
                try:
                    while data := stream.read(4096):
                        remaining = OUTPUT_LIMIT - len(buffer)
                        buffer.extend(data[:max(0, remaining)])
                        if len(data) > remaining:
                            overflow.set()
                finally:
                    stream.close()

            def feed():
                try:
                    proc.stdin.write(stdin.encode())
                    proc.stdin.flush()
                except (BrokenPipeError, OSError):
                    pass
                finally:
                    proc.stdin.close()

            for stream, buffer in zip((proc.stdout, proc.stderr), buffers):
                thread = threading.Thread(target=drain, args=(stream, buffer), daemon=True)
                thread.start()
                readers.append(thread)
            writer = threading.Thread(target=feed, daemon=True)
            writer.start()
            while proc.poll() is None:
                result.cancelled = cancel.is_set()
                result.timeout = time.monotonic() - start > timeout
                result.overflow = overflow.is_set()
                if result.cancelled or result.timeout or result.overflow:
                    self._remove(name)
                    if proc.poll() is None:
                        proc.kill()
                    break
                time.sleep(0.02)
            proc.wait(timeout=5)
            for thread in readers:
                thread.join(timeout=2)
            writer.join(timeout=1)
            result.returncode = proc.returncode
            result.overflow |= overflow.is_set()
            if result.returncode == 137 and not (result.timeout or result.cancelled or result.overflow):
                check = subprocess.run(["docker", "inspect", "--format", "{{.State.OOMKilled}}", name],
                                       capture_output=True, text=True, timeout=5)
                result.oom = check.returncode == 0 and check.stdout.strip() == "true"
        except (OSError, subprocess.TimeoutExpired) as exc:
            result.stderr = f"Runner infrastructure error: {type(exc).__name__}"
        finally:
            self._remove(name)
            if proc is not None and proc.poll() is None:
                proc.kill()
                proc.wait(timeout=5)
        result.stdout = buffers[0].decode("utf-8", errors="replace")
        result.stderr += buffers[1].decode("utf-8", errors="replace")
        if result.overflow:
            result.stderr = result.stderr[:OUTPUT_LIMIT - 80] + "\nOutput limit exceeded; execution terminated."
        return result

    @staticmethod
    def _validate_files(files: dict[str, str]) -> list[str]:
        if not isinstance(files, dict) or not 1 <= len(files) <= 16:
            raise ValueError("Provide between 1 and 16 source/header files.")
        for name, value in files.items():
            if not isinstance(name, str) or not SAFE_FILE.fullmatch(name) or ".." in name:
                raise ValueError("Use flat C/C++ filenames with letters, numbers, underscores, dots or hyphens.")
            if not isinstance(value, str) or len(value.encode()) > 128 * 1024:
                raise ValueError("Each source file must be text no larger than 128 KiB.")
        if sum(len(v.encode()) for v in files.values()) > SOURCE_LIMIT:
            raise ValueError("Combined source files exceed 512 KiB.")
        sources = [name for name in files if Path(name).suffix in SOURCE_EXTENSIONS]
        if not sources:
            raise ValueError("At least one C or C++ source file is required.")
        return sources

    def run(self, question: dict, files: dict[str, str], include_hidden: bool = False,
            cancel_event: threading.Event | None = None) -> dict:
        started = time.monotonic()
        cancel = cancel_event or threading.Event()
        result = {"status": "unsupported", "tests": [], "compiler_output": "", "passed": 0, "total": 0, "elapsed_ms": 0}

        def finish(status: str, detail: str = "") -> dict:
            result["status"] = status
            if detail:
                result["compiler_output"] = detail[:OUTPUT_LIMIT]
            result["elapsed_ms"] = round((time.monotonic() - started) * 1000)
            return result

        config = question.get("test_config")
        if not config or question.get("language") not in ("c", "cpp"):
            return finish("unsupported", "This question has no executable C/C++ tests.")
        try:
            sources = self._validate_files(files)
            if config.get("mode") not in ("stdio", "fixture") or config.get("compiler") not in ("gcc", "clang"):
                raise ValueError("Unsupported execution mode or compiler.")
            timeout = float(config.get("timeout_seconds", 2))
            if not 1 <= timeout <= 5:
                raise ValueError("Test timeout must be between 1 and 5 seconds.")
            tests = config["tests"]
            if not isinstance(tests, list) or not 1 <= len(tests) <= 64:
                raise ValueError("Provide between 1 and 64 tests.")
            for test in tests:
                if test.get("visibility") not in ("public", "hidden"):
                    raise ValueError("Every test must declare public or hidden visibility.")
                for field in ("stdin", "expected_stdout", "fixture"):
                    value = test.get(field, "")
                    if not isinstance(value, str) or len(value.encode()) > 64 * 1024:
                        raise ValueError(f"Test {field} must be text no larger than 64 KiB.")
                if config["mode"] == "fixture" and not test.get("fixture"):
                    raise ValueError("Fixture tests require an explicit C/C++ main file.")
            tests = [test for test in tests if include_hidden or test["visibility"] == "public"]
        except (ValueError, TypeError, KeyError) as exc:
            return finish("unsupported", str(exc))
        result["total"] = len(tests)
        if cancel.is_set():
            return finish("cancelled")
        if not tests:
            return finish("unsupported", "There are no public tests to run. Submit to evaluate hidden tests.")
        availability = self.availability()
        if not availability["available"]:
            return finish("unavailable", availability["detail"])
        image = availability["image_id"]
        cpp = question["language"] == "cpp"
        compiler = {("gcc", False): "/usr/bin/gcc", ("gcc", True): "/usr/bin/g++",
                    ("clang", False): "/usr/bin/clang", ("clang", True): "/usr/bin/clang++"}[(config["compiler"], cpp)]
        flags = ["-std=c++17" if cpp else "-std=c11", "-Wall", "-Wextra", "-O1", "-g"]
        if config.get("sanitizers"):
            flags += ["-fsanitize=address,undefined", "-fno-omit-frame-pointer"]
        with tempfile.TemporaryDirectory(prefix="forgepad-") as tmp:
            root = Path(tmp)
            root.chmod(0o755)
            src, objects, fixture, program = [root / name for name in ("src", "objects", "fixture", "program")]
            for directory in (src, objects, fixture, program):
                directory.mkdir(mode=0o777)
                directory.chmod(0o777)
            for name, content in files.items():
                (src / name).write_text(content)
                (src / name).chmod(0o644)
            object_names = []
            for index, name in enumerate(sources):
                obj = f"user_{index}.o"
                command = [compiler, *flags, "-x", "c++" if cpp else "c", "-I/src", "-c", f"/src/{name}", "-o", f"/build/{obj}"]
                compiled = self._container(image, command, [(src, "/src", True), (objects, "/build", False)], 25, cancel, compile_job=True)
                result["compiler_output"] = (result["compiler_output"] + compiled.stderr)[:OUTPUT_LIMIT]
                if compiled.cancelled:
                    return finish("cancelled")
                if compiled.returncode or compiled.timeout or compiled.overflow:
                    return finish("compilation_error", result["compiler_output"] or "Compilation exceeded its resource limits.")
                object_names.append(f"/objects/{obj}")
            for index, test in enumerate(tests):
                test_start = time.monotonic()
                hidden = test["visibility"] == "hidden"
                item = {"id": test.get("id", str(index)), "name": "Hidden test" if hidden else test.get("name", "Test"),
                        "visibility": test["visibility"], "status": "runtime_error", "stdout": "", "stderr": "", "elapsed_ms": 0}
                if not hidden:
                    item["expected_stdout"] = test.get("expected_stdout", "")
                # Fresh output/fixture directories prevent one test affecting another.
                test_build = root / f"build_{index}"
                test_build.mkdir(mode=0o777)
                test_build.chmod(0o777)
                link_inputs = list(object_names)
                compiled = ProcessResult(0)
                if config["mode"] == "fixture":
                    fixture_file = fixture / ("fixture.cpp" if cpp else "fixture.c")
                    fixture_file.write_text(test["fixture"])
                    fixture_file.chmod(0o644)
                    compiled = self._container(image, [compiler, *flags, "-I/src", "-c", f"/fixture/{fixture_file.name}", "-o", "/build/fixture.o"],
                                               [(fixture, "/fixture", True), (src, "/src", True), (test_build, "/build", False)], 25, cancel, compile_job=True)
                    link_inputs.append("/build/fixture.o")
                if not (compiled.returncode or compiled.timeout or compiled.overflow or compiled.cancelled):
                    compiled = self._container(image, [compiler, *flags, *link_inputs, "-o", "/build/submission"],
                                               [(objects, "/objects", True), (test_build, "/build", False)], 25, cancel, compile_job=True)
                if compiled.cancelled:
                    return finish("cancelled")
                if compiled.returncode or compiled.timeout or compiled.overflow:
                    item["status"] = "compilation_error"
                    item["stderr"] = "Hidden test compilation failed." if hidden else compiled.stderr
                else:
                    binary = test_build / "submission"
                    if not binary.is_file() or binary.is_symlink() or not stat.S_ISREG(binary.stat().st_mode) or binary.stat().st_size > 16 * 1024 * 1024:
                        return finish("compilation_error", "Compiler did not produce a valid bounded executable.")
                    destination = program / "submission"
                    shutil.copyfile(binary, destination)
                    destination.chmod(0o555)
                    executed = self._container(image, ["/program/submission"], [(program, "/program", True)], timeout, cancel, test.get("stdin", ""))
                    if executed.cancelled:
                        return finish("cancelled")
                    if executed.timeout:
                        item["status"] = "timeout"
                    elif executed.oom:
                        item["status"] = "memory_limit"
                    elif config.get("sanitizers") and executed.returncode and any(marker in executed.stderr for marker in ("AddressSanitizer", "UndefinedBehaviorSanitizer", "runtime error:")):
                        item["status"] = "sanitizer_failure"
                    elif executed.returncode or executed.overflow:
                        item["status"] = "runtime_error"
                    elif executed.stdout.replace("\r\n", "\n") == test.get("expected_stdout", "").replace("\r\n", "\n"):
                        item["status"] = "passed"
                    else:
                        item["status"] = "wrong_answer"
                    if not hidden:
                        item["stdout"], item["stderr"] = executed.stdout, executed.stderr
                item["elapsed_ms"] = round((time.monotonic() - test_start) * 1000)
                result["tests"].append(item)
                result["passed"] += item["status"] == "passed"
        failed = next((test["status"] for test in result["tests"] if test["status"] != "passed"), None)
        return finish(failed or "passed")
