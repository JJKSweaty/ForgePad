# C/C++ runner

Build the dedicated image from the repository root:

```sh
docker build -t forgepad-runner:local sandbox
```

Docker Desktop, a Linux Docker daemon, or a compatible Colima Docker context is required. Set `DOCKER_CONTEXT` in the backend environment if your runtime is not the default context. `FORGEPAD_RUNNER_IMAGE` optionally selects an existing image. Temporary compiler files live in ignored `data/runner` so macOS container runtimes can mount them; `FORGEPAD_RUNNER_TMPDIR` can select another Docker-shared directory. Each job directory is deleted on completion. The backend resolves and pins its local image digest for each job; it never pulls an image or falls back to host compilation. Install and build while online, then use the runner offline.

The image includes GCC/G++ and Clang/Clang++. C11 and C++17, multiple source files, headers, standard input/output, explicit main fixtures, and optional AddressSanitizer/UndefinedBehaviorSanitizer are supported. Warnings do not fail a run. Output is compared exactly after CRLF normalization; whitespace is otherwise significant. LeakSanitizer is disabled because its tracing requirements conflict with restricted containers. No MCU timing, ISR atomicity, hardware memory ordering, or real peripheral behavior is established by these host tests.

Each source is compiled to an object in an isolated compiler container. Fixture compilation occurs separately, followed by linking; submitted translation units cannot include hidden fixture sources. Each test executes in a fresh container with only its executable mounted read-only. The trusted backend, outside the worker, compares stdout to expected output. A program cannot forge the result protocol by printing JSON. Hidden stdout, stderr, expected outputs, fixture compiler diagnostics, and descriptive test names are redacted even during reference validation. Reference validation receives all test statuses and counts.

Every container uses:

- No network, UID/GID 65534, dropped capabilities, no-new-privileges, and Docker's default seccomp policy.
- A read-only root filesystem; a 32 MiB noexec/nosuid/nodev `/tmp`; only the compiler's disposable output directory is writable on a bind mount.
- One CPU, 256 MiB memory with no additional swap, 32 processes, 64 file descriptors, 16 MiB file size limit, and a CPU time limit.
- A host-enforced wall limit (25 seconds per compiler operation and 1–5 seconds per test, including container startup), bounded 64 KiB stdout and 64 KiB stderr, and cancellation monitoring.

Only flat source/header names are accepted, with 20 files maximum and 256 KiB combined. No user-supplied compiler flags or shell commands are accepted. Input/expected output/fixture text is limited to 64 KiB each. Output flooding terminates the container as a runtime error. OOM termination confirmed by Docker is reported as a memory limit failure; other crashes remain runtime errors. Sanitizer failures are recognized from a nonzero process exit plus sanitizer diagnostics, so user-controlled text cannot produce a passing verdict.

Container removal runs on success, failure, timeout and cancellation. If the Docker daemon stops responding, cleanup is best effort; resource limits remain configured at the daemon. When restoring a failed daemon, inspect stale workers with `docker ps -a --filter name=forgepad-` and remove them. This is a local developer sandbox, not a hardened multi-tenant execution service; keep Docker and its host kernel updated. Do not expose the API directly to untrusted networks.

Run verification from `backend`:

```sh
python -m pytest tests/test_runner.py
python -m pytest tests/test_runner_docker.py -v
```

Integration tests actually compile and execute C/C++, check both toolchains, hidden-data redaction, invalid code, infinite loops, excessive output, memory exhaustion, sanitizer failures, filesystem/network isolation, verdict spoofing, and cancellation. They skip with an explicit reason if the image or Docker daemon is unavailable. Unit tests alone do not verify isolation.
