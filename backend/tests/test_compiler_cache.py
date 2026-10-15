from forgepad.compiler_cache import CompilerCache, cache_key


def test_reference_and_candidate_cannot_share_artifacts_or_stale_tests(tmp_path):
    q = {"language": "c", "test_config": {"tests": [{"expected_stdout": "1"}]}}
    key = cache_key(q, {"main.c": "int main(void){return 0;}"}, "sha256:a", "clang", ["-O1"])
    assert key != cache_key(q, {"main.c": "int main(void){return 1;}"}, "sha256:a", "clang", ["-O1"])
    assert key != cache_key(q, {"main.c": "int main(void){return 0;}"}, "sha256:b", "clang", ["-O1"])
    assert key != cache_key(q, {"main.c": "int main(void){return 0;}"}, "sha256:a", "clang", ["-O2"])
    assert key != cache_key(
        q, {"main.c": "int main(void){return 0;}"}, "sha256:a", "clang", ["-O1"], include_hidden=True
    )
    altered = {"language": "c", "test_config": {"tests": [{"expected_stdout": "2"}]}}
    assert key != cache_key(altered, {"main.c": "int main(void){return 0;}"}, "sha256:a", "clang", ["-O1"])


def test_corrupt_or_symlinked_artifacts_are_recompiled(tmp_path):
    binary = tmp_path / "source"
    binary.write_bytes(b"bounded executable artifact")
    cache = CompilerCache(tmp_path / "cache", "key")
    cache.publish({0: binary})
    loaded = CompilerCache(tmp_path / "cache", "key")
    restored = tmp_path / "restored"
    assert loaded.restore(0, restored)
    artifact = tmp_path / "cache" / "key" / "0.bin"
    artifact.chmod(0o755)
    artifact.write_bytes(b"corrupt executable artifact")
    assert not loaded.restore(0, restored)
    artifact.unlink()
    artifact.symlink_to(binary)
    assert not loaded.restore(0, restored)
