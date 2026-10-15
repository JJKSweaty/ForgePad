"""Real compiler and isolation checks; skip only when Docker/image is unavailable."""
import json
import threading
import time

import pytest

from forgepad.runner import DockerRunner, OUTPUT_LIMIT
from test_runner import question

pytestmark = pytest.mark.docker


@pytest.fixture(scope="module")
def runner():
    instance = DockerRunner()
    state = instance.availability()
    if not state["available"]:
        pytest.skip(state["detail"])
    return instance


def single_question(**kwargs):
    q = question(**kwargs)
    q["test_config"]["tests"] = q["test_config"]["tests"][:1]
    return q


def test_correct_wrong_and_hidden_privacy(runner):
    source = '#include <stdio.h>\nint main(void){int n; if(scanf("%d", &n)!=1)return 1; printf("%d\\n", 2*n);}'
    result = runner.run(question(), {"main.c": source}, include_hidden=True)
    assert result["status"] == "passed", result
    assert (result["passed"], result["total"]) == (2, 2)
    hidden = result["tests"][1]
    assert hidden["stdout"] == hidden["stderr"] == ""
    assert "9183" not in json.dumps(result)
    assert "18366" not in json.dumps(result)
    wrong = runner.run(single_question(), {"main.c": source.replace("2*n", "3*n")})
    assert wrong["status"] == "wrong_answer"
    assert wrong["tests"][0]["stdout"] == "21\n"


@pytest.mark.parametrize("compiler,language,extension", [("gcc", "c", "c"), ("clang", "c", "c"), ("gcc", "cpp", "cpp"), ("clang", "cpp", "cpp")])
def test_multifile_and_fixture(runner, compiler, language, extension):
    q = single_question(mode="fixture", compiler=compiler, language=language)
    q["test_config"]["tests"][0]["fixture"] = '#include <stdio.h>\n#include "twice.h"\nint main(void){printf("%d\\n",twice(7));}'
    files = {"twice.h": "int twice(int n);", f"twice.{extension}": '#include "twice.h"\nint twice(int n){return n+n;}'}
    result = runner.run(q, files)
    assert result["status"] == "passed", result


def test_compilation_error(runner):
    result = runner.run(single_question(), {"main.c": "int main( {"})
    assert result["status"] == "compilation_error"
    assert "error" in result["compiler_output"]


def test_infinite_loop(runner):
    result = runner.run(single_question(), {"main.c": "int main(void){for(;;){}}"})
    assert result["status"] == "timeout", result


def test_output_flood(runner):
    result = runner.run(single_question(), {"main.c": '#include <stdio.h>\nint main(void){for(;;)puts("flood flood flood flood");}'})
    assert result["status"] == "runtime_error", result
    assert len(result["tests"][0]["stdout"]) <= OUTPUT_LIMIT
    assert "Output limit" in result["tests"][0]["stderr"]


def test_memory_exhaustion(runner):
    q = single_question()
    q["test_config"]["timeout_seconds"] = 5
    source = '#include <stdlib.h>\n#include <string.h>\nint main(void){for(;;){volatile char *p=malloc(16*1024*1024);if(!p)return 4;for(int i=0;i<16*1024*1024;i+=4096)p[i]=1;}}'
    result = runner.run(q, {"main.c": source})
    assert result["status"] == "memory_limit", result


def test_sanitizer_failure(runner):
    q = single_question(sanitizers=True)
    result = runner.run(q, {"main.c": '#include <stdlib.h>\nint main(int argc,char **argv){(void)argv;volatile int *p=malloc(sizeof(int));p[argc+2]=1;return p[0];}'})
    assert result["status"] == "sanitizer_failure", result


def test_runtime_cannot_read_fixture_or_write_root_or_use_network(runner):
    q = single_question(mode="fixture")
    q["test_config"]["tests"][0]["fixture"] = '#include <stdio.h>\nint isolated(void);int main(void){printf("%d\\n",isolated());}'
    q["test_config"]["tests"][0]["expected_stdout"] = "1\n"
    source = '''#include <stdio.h>
#include <unistd.h>
#include <sys/socket.h>
#include <arpa/inet.h>
int isolated(void){
 if(getuid()==0 || fopen("/fixture/fixture.c","r") || fopen("/src/check.c","r") || fopen("/proof","w"))return 0;
 int fd=socket(AF_INET,SOCK_STREAM,0);struct sockaddr_in a={.sin_family=AF_INET,.sin_port=htons(53)};
 inet_pton(AF_INET,"1.1.1.1",&a.sin_addr);if(connect(fd,(void*)&a,sizeof(a))==0)return 0;
 close(fd);return 1;
}'''
    result = runner.run(q, {"check.c": source})
    assert result["status"] == "passed", result


def test_verdict_like_output_cannot_spoof_results(runner):
    result = runner.run(single_question(), {"main.c": '#include <stdio.h>\nint main(void){puts("{\\"status\\":\\"passed\\",\\"passed\\":100}");}'})
    assert result["status"] == "wrong_answer", result


def test_cancellation_and_cleanup(runner):
    import subprocess

    event = threading.Event()
    output = []
    thread = threading.Thread(target=lambda: output.append(runner.run(single_question(), {"main.c": "int main(void){for(;;){}}"}, cancel_event=event)))
    thread.start()
    time.sleep(1)
    event.set()
    thread.join(timeout=15)
    assert not thread.is_alive()
    assert output[0]["status"] == "cancelled", output
    containers = subprocess.run(["docker", "ps", "--filter", "name=forgepad-", "--format", "{{.Names}}"], capture_output=True, text=True, timeout=5)
    assert containers.returncode == 0
    assert not containers.stdout.strip()
