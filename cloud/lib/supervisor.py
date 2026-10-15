"""Trusted VM supervisor. Submitted programs never run in the API process.

Run only as root inside a disposable, network-disabled Vercel Sandbox. Test
specifications are private to the administrative worker account. Children drop to nobody and
cannot regain privileges. The supervisor compares outputs outside the child.
"""

import ctypes
import json
import os
import re
import resource
import selectors
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

LIMIT = 65536
SAFE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.(?:c|cpp|cc|h|hpp)$")


def process(args, cwd, timeout, stdin="", *, compilation=False, sanitizers=False):
    def restrict():
        os.setsid()
        resource.setrlimit(resource.RLIMIT_CPU, (int(timeout) + 1, int(timeout) + 1))
        resource.setrlimit(resource.RLIMIT_FSIZE, (16 * 1024**2, 16 * 1024**2))
        resource.setrlimit(resource.RLIMIT_NPROC, (32, 32))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        if not compilation and not sanitizers:
            resource.setrlimit(resource.RLIMIT_AS, (256 * 1024**2, 256 * 1024**2))
        os.setgroups([])
        os.setgid(65534)
        os.setuid(65534)
        if ctypes.CDLL(None).prctl(38, 1, 0, 0, 0) != 0:  # PR_SET_NO_NEW_PRIVS
            os._exit(125)

    started = time.monotonic()
    # Disk-backed stdin avoids deadlocking before output is drained.
    with tempfile.TemporaryFile() as input_file:
        input_file.write(stdin.encode())
        input_file.seek(0)
        proc = subprocess.Popen(args, cwd=cwd, stdin=input_file, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, preexec_fn=restrict,  # noqa: PLW1509 -- standalone, single-threaded supervisor
                                env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "HOME": "/tmp",
                                     "ASAN_OPTIONS": "detect_leaks=0:abort_on_error=1",
                                     "UBSAN_OPTIONS": "halt_on_error=1"})
        output = {"stdout": bytearray(), "stderr": bytearray()}
        status = None
        with selectors.DefaultSelector() as selector:
            for stream, name in ((proc.stdout, "stdout"), (proc.stderr, "stderr")):
                os.set_blocking(stream.fileno(), False)
                selector.register(stream, selectors.EVENT_READ, name)
            while selector.get_map():
                if time.monotonic() - started > timeout:
                    status = "timeout"
                    break
                for key, _ in selector.select(0.03):
                    data = os.read(key.fileobj.fileno(), 8192)
                    if not data:
                        selector.unregister(key.fileobj)
                    else:
                        output[key.data].extend(data)
                        if len(output[key.data]) > LIMIT:
                            status = "runtime_error"
                            break
                if status:
                    break
        # Kill surviving descendants, including children that closed the inherited pipes.
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait(timeout=3)
    return {"code": proc.returncode, "status": status,
            "stdout": output["stdout"][:LIMIT].decode("utf-8", errors="replace"),
            "stderr": output["stderr"][:LIMIT].decode("utf-8", errors="replace"),
            "elapsed_ms": round((time.monotonic() - started) * 1000)}


def run(request):
    started = time.monotonic()
    question, files = request["question"], request["files"]
    if not files or len(files) > 20 or any(not SAFE.fullmatch(n) or ".." in n for n in files):
        raise ValueError("Invalid source filenames")
    if sum(len(v.encode()) for v in files.values()) > 256 * 1024 or any("\0" in v for v in files.values()):
        raise ValueError("Invalid source size or contents")
    config = question["test_config"]
    tests = [t for t in config["tests"] if request.get("include_hidden") or t["visibility"] == "public"]
    compiler = config.get("compiler", "gcc")
    if compiler not in {"gcc", "clang"} or question["language"] not in {"c", "cpp"}:
        raise ValueError("Unsupported compiler or language")
    if question["language"] == "cpp":
        compiler = "g++" if compiler == "gcc" else "clang++"
    flags = ["-std=c++17" if question["language"] == "cpp" else "-std=c11", "-O0", "-Wall", "-Wextra"]
    sanitizers = bool(config.get("sanitizers"))
    if sanitizers:
        flags += ["-fsanitize=address,undefined", "-fno-omit-frame-pointer"]
    timeout = min(5, max(1, int(config.get("timeout_seconds", 2))))
    result = {"status": "passed", "tests": [], "passed": 0, "total": len(tests), "compiler_output": ""}
    base = Path(tempfile.mkdtemp(prefix="forgepad-", dir="/tmp"))
    os.chmod(base, 0o755)
    sources, objects = base / "source", base / "objects"
    sources.mkdir(mode=0o755)
    objects.mkdir(mode=0o777)
    os.chmod(objects, 0o777)
    try:
        for name, source in files.items():
            path = sources / name
            path.write_text(source)
            path.chmod(0o644)
        object_paths = []
        # Compile candidate units before any hidden fixture is materialized.
        for i, name in enumerate(files):
            if not name.endswith((".c", ".cc", ".cpp")):
                continue
            target = objects / f"candidate-{i}.o"
            compiled = process([compiler, *flags, "-I", str(sources), "-c", str(sources / name), "-o", str(target)],
                               objects, 20, compilation=True, sanitizers=sanitizers)
            result["compiler_output"] += compiled["stdout"] + compiled["stderr"]
            if compiled["status"] or compiled["code"]:
                result["status"] = compiled["status"] or "compilation_error"
                return result
            target.chmod(0o644)
            object_paths.append(str(target))
        if not object_paths:
            result.update(status="compilation_error", compiler_output="Provide a C/C++ source file.")
            return result
        for i, test in enumerate(tests):
            hidden = test["visibility"] == "hidden"
            case = {"id": test["id"], "name": f"Hidden test {i+1}" if hidden else test["name"],
                    "visibility": test["visibility"], "status": "passed"}
            test_dir = base / f"test-{i}"
            test_dir.mkdir(mode=0o777)
            os.chmod(test_dir, 0o777)
            binary = test_dir / "program"
            inputs = list(object_paths)
            fixture_path = None
            if config["mode"] == "fixture":
                fixture_path = test_dir / ("fixture.cpp" if question["language"] == "cpp" else "fixture.c")
                fixture_path.write_text(test["fixture"])
                fixture_path.chmod(0o644)
                inputs.append(str(fixture_path))
            compiled = process([compiler, *flags, "-I", str(sources), *inputs, "-o", str(binary)], test_dir, 20,
                               compilation=True, sanitizers=sanitizers)
            if fixture_path:
                fixture_path.unlink(missing_ok=True)
            if compiled["status"] or compiled["code"]:
                case["status"] = compiled["status"] or "compilation_error"
                if not hidden:
                    case["stderr"] = compiled["stdout"] + compiled["stderr"]
            else:
                # No fixture text, expected output, request data, or other test binary
                # is readable by the unprivileged submitted program.
                binary.chmod(0o555)
                test_dir.chmod(0o755)
                execution = process([str(binary)], test_dir, timeout, test.get("stdin", ""), sanitizers=sanitizers)
                output = execution["stdout"].replace("\r\n", "\n")
                expected = test["expected_stdout"].replace("\r\n", "\n")
                case["status"] = execution["status"] or (
                    "sanitizer_failure" if execution["code"] and sanitizers and
                    re.search(r"AddressSanitizer|runtime error:|UndefinedBehaviorSanitizer", execution["stderr"])
                    else "runtime_error" if execution["code"] else "passed" if output == expected else "wrong_answer")
                case["elapsed_ms"] = execution["elapsed_ms"]
                if not hidden:
                    case.update(stdout=execution["stdout"], stderr=execution["stderr"], expected_stdout=test["expected_stdout"])
            test_dir.chmod(0o700)
            result["tests"].append(case)
            if case["status"] == "passed":
                result["passed"] += 1
            elif result["status"] == "passed":
                result["status"] = case["status"]
        return result
    finally:
        result["elapsed_ms"] = round((time.monotonic() - started) * 1000)
        result["compiler_output"] = result["compiler_output"][:LIMIT]
        shutil.rmtree(base, ignore_errors=True)


if __name__ == "__main__":
    try:
        print(json.dumps(run(json.loads(Path(sys.argv[1]).read_text()))))
    except Exception:  # noqa: BLE001 -- fail closed; never synthesize a passing verdict
        print(json.dumps({"status": "unavailable", "passed": 0, "total": 0, "tests": [],
                          "compiler_output": "Cloud worker failed before producing a verdict."}))
