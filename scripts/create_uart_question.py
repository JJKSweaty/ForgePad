"""Generate an original, deterministic UART fault-injection question package."""
import json
from pathlib import Path

HEADER = """#ifndef UART_RX_H
#define UART_RX_H
#include <stdbool.h>
#include <stdint.h>
typedef struct {
    uint8_t state, length, used, sum, payload[4];
    uint32_t last_tick;
} uart_rx_t;
void uart_rx_init(uart_rx_t *r);
bool uart_rx_feed(uart_rx_t *r, uint8_t byte, uint32_t tick,
                  uint8_t out[4], uint8_t *out_length);
#endif
"""
REFERENCE = """#include "uart_rx.h"
void uart_rx_init(uart_rx_t *r) {
    if (r) { r->state=0; r->length=0; r->used=0; r->sum=0; r->last_tick=0; }
}
bool uart_rx_feed(uart_rx_t *r, uint8_t byte, uint32_t tick,
                  uint8_t out[4], uint8_t *out_length) {
    if (!r || !out || !out_length) return false;
    if (r->state && (uint32_t)(tick-r->last_tick)>UINT32_C(10)) r->state=0;
    r->last_tick=tick;
    switch (r->state) {
    case 0:
        if (byte==UINT8_C(0xA5)) r->state=1;
        return false;
    case 1:
        if (byte<1 || byte>4) { r->state=0; return false; }
        r->length=byte; r->used=0; r->sum=byte; r->state=2;
        return false;
    case 2:
        r->payload[r->used++]=byte;
        r->sum=(uint8_t)(r->sum+byte);
        if (r->used==r->length) r->state=3;
        return false;
    default:
        r->state=0;
        if (byte!=r->sum) return false;
        for (uint8_t i=0;i<r->length;++i) out[i]=r->payload[i];
        *out_length=r->length;
        return true;
    }
}
"""
BROKEN = """#include "uart_rx.h"
void uart_rx_init(uart_rx_t *r) { r->state=0; r->used=0; }
bool uart_rx_feed(uart_rx_t *r, uint8_t byte, uint32_t tick,
                  uint8_t out[4], uint8_t *out_length) {
    (void)tick;
    if (r->state==0) { if (byte==0xA5) r->state=1; return false; }
    if (r->state==1) { r->length=byte; r->used=0; r->state=2; return false; }
    if (r->state==2) {
        r->payload[r->used++]=byte;
        if (r->used==r->length) r->state=3;
        return false;
    }
    for (uint8_t i=0;i<r->length;++i) out[i]=r->payload[i];
    *out_length=r->length; r->state=0;
    return true;
}
"""


def fixture(events):
    data = ",".join("{%su,%su}" % (byte, tick) for byte, tick in events)
    return """#include "uart_rx.h"
#include <stdio.h>
#include <string.h>
int main(void) {
 uart_rx_t r; uart_rx_init(&r);
 uint8_t out[4]={238,238,238,238}, n=204;
 unsigned frames=0; int untouched=1;
 const struct { uint8_t b; uint32_t t; } input[] = {""" + data + """};
 for (unsigned i=0;i<sizeof input/sizeof input[0];++i) {
  uint8_t before[4]; memcpy(before,out,4); uint8_t previous=n;
  if (uart_rx_feed(&r,input[i].b,input[i].t,out,&n)) {
   printf("%u:",(unsigned)n);
   for (unsigned j=0;j<n && j<4;++j) printf("%02x",(unsigned)out[j]);
   puts(""); ++frames;
  } else if (n!=previous || memcmp(before,out,4)!=0) untouched=0;
 }
 printf("frames=%u untouched=%d\\n",frames,untouched);
 return 0;
}
"""


cases = [
    ("valid", "Valid two-byte packet", "public", "normal", [(165,0),(2,1),(17,2),(34,3),(53,4)], "2:1122\nframes=1 untouched=1\n"),
    ("corrupt", "Corrupted checksum followed by recovery", "public", "normal", [(165,0),(1,1),(68,2),(0,3),(165,4),(1,5),(51,6),(52,7)], "1:33\nframes=1 untouched=1\n"),
    ("length", "Oversized length rejected before writing", "public", "negative", [(165,0),(5,1),(9,2),(165,3),(1,4),(0,5),(1,6)], "1:00\nframes=1 untouched=1\n"),
    ("maximum", "Maximum payload and checksum wrap", "hidden", "boundary", [(165,0),(4,1),(255,2),(0,3),(165,4),(254,5),(166,6)], "4:ff00a5fe\nframes=1 untouched=1\n"),
    ("rollover", "Hardware tick rollover", "hidden", "boundary", [(165,4294967293),(2,4294967294),(1,4294967295),(2,0),(5,1)], "2:0102\nframes=1 untouched=1\n"),
    ("exact-gap", "Ten ticks is within the timeout", "hidden", "boundary", [(165,0),(1,10),(7,20),(8,30)], "1:07\nframes=1 untouched=1\n"),
    ("timeout", "Truncated frame times out; current byte is a sync", "hidden", "boundary", [(165,0),(2,1),(16,2),(165,20),(1,21),(9,22),(10,23)], "1:09\nframes=1 untouched=1\n"),
    ("zero", "Zero length is invalid", "hidden", "negative", [(165,0),(0,1),(165,2),(1,3),(255,4),(0,5)], "1:ff\nframes=1 untouched=1\n"),
]
tests = [{"id":i,"name":n,"visibility":v,"category":c,"stdin":"","expected_stdout":o,"fixture":fixture(e)} for i,n,v,c,e,o in cases]
tests.append({"id":"null","name":"Null arguments preserve parser state","visibility":"hidden","category":"negative","stdin":"","expected_stdout":"0 0 0 0\n","fixture": """#include "uart_rx.h"
#include <stdio.h>
int main(void) {
 uart_rx_t r; uart_rx_init(&r); uint8_t out[4]={0},n=0;
 int a=uart_rx_feed(0,165,1,out,&n);
 int b=uart_rx_feed(&r,165,1,0,&n);
 int c=uart_rx_feed(&r,165,1,out,0);
 printf("%d %d %d %u\\n",a,b,c,(unsigned)r.state);
 return 0;
}
"""})
question = {
 "schema_version":"1.0", "id":"uart-frame-recovery", "version":1,
 "title":"Repair a UART receiver after corrupted and truncated frames",
 "description":"Debug a bounded UART packet parser using deterministic byte corruption, timeouts, and a wrapping hardware timer.",
 "type":"debugging", "difficulty":"intermediate", "topics":["UART","fault injection","bounded buffers","timer rollover","state machines"],
 "duration_minutes":30,"language":"c",
 "prompt":"A sensor sends [0xA5, length, payload..., checksum]. Length is 1–4 bytes. The checksum is (length + every payload byte) modulo 256; 0xA5 is allowed inside payloads and checksums. The provided parser sometimes emits corrupted samples, writes past its buffer after an invalid length, and remains stuck after a truncated packet. Repair uart_rx_feed and uart_rx_init using the exact declarations in uart_rx.h.\n\nProcess one byte per call. Return true only when a complete packet has a valid checksum, copy exactly length bytes into out, set *out_length, and reset to waiting for sync. Every false return leaves all four output bytes and *out_length unchanged. An invalid length or a checksum mismatch consumes that byte and resets to waiting for the NEXT byte; do not reinterpret the rejected byte as a sync.\n\nBefore processing a byte in an unfinished packet, reset if the unsigned 32-bit elapsed ticks since the previous byte exceed 10. Exactly 10 ticks is accepted. After a timeout, process the CURRENT byte as a possible sync. uart_rx_init discards any unfinished frame. A null r, out, or out_length returns false without changing any state; initializing a null r is a no-op.\n\nThe supplied code is intentionally broken: unchecked lengths can cause undefined out-of-bounds writes. The repaired implementation must eliminate this bug. Public fixtures reproduce checksum corruption and malformed lengths without hardware. No test establishes electrical UART behavior or ISR safety.",
 "constraints":["C11; uint8_t and uint32_t are available. No allocation, recursion, blocking, or unbounded loops.","Calls are single-threaded; initialize each parser before use. Only this API mutates the parser.","Non-null r points to a valid uart_rx_t; non-null out points to at least four writable bytes; non-null out_length points to one writable byte. The three regions do not overlap.","Tick advances monotonically modulo 2^32; fewer than 2^32 ticks elapse between calls. Use unsigned elapsed-time arithmetic.","Do not change uart_rx_t or the function signatures. Unused bytes of out must remain unchanged on success as well."],
 "starter_files":{"uart_rx.h":HEADER,"solution.c":BROKEN},
 "test_config":{"mode":"fixture","compiler":"gcc","sanitizers":True,"timeout_seconds":2,"tests":tests},
 "reference_solution":{"uart_rx.h":HEADER,"solution.c":REFERENCE},
 "solution_notes":"Use four states: waiting for sync, reading length, collecting bounded payload, and checking checksum. Validate pointers before mutation. Expire an unfinished frame with uint32_t subtraction, then process the current byte. Validate length before any buffer write. Accumulate checksum modulo 256 using uint8_t conversion. Copy into caller output only after the checksum matches. Reset after rejection or completion. The fixtures model faults deterministically; they do not model UART electrical errors or concurrent access.",
 "time_complexity":"O(1) per byte; a successful packet copies at most four bytes.",
 "space_complexity":"O(1), using the caller-owned parser and fixed four-byte payload storage.",
 "rubric":["30 points: reject malformed lengths and corrupt checksums; recover at the documented next sync.","25 points: bounded writes, valid-pointer guards, no output mutation on false, and exact copy length on success.","25 points: timeout behavior at 10/11 ticks, current-byte resynchronization, and timer wraparound.","10 points: deterministic initialization, allocation-free state transitions, and readable C11 code.","10 points: explain fault-injection coverage and the limits of host tests."],
 "follow_ups":["A burst error can turn payload into 0xA5. How would a length-delimited frame with CRC and sequence number change your recovery policy?","If the UART ISR calls this parser and a task consumes completed packets, who owns each output buffer and when is it safe to reuse it?","What happens to the timeout if this timer stops in sleep, and which timer would you use instead?"],
 "hints":["Keep caller output untouched until all validation has succeeded.","Reset stale state before interpreting the incoming byte; unsigned subtraction handles the documented timer wrap.","Validate length before the first payload write, and distinguish payload bytes from framing bytes."],
 "source":{"name":"ForgePad original firmware fault scenario","url":"","license":"CC0-1.0"}
}
if __name__ == '__main__':
 path=Path(__file__).resolve().parents[1]/'questions'/'uart-frame-recovery.json'
 path.write_text(json.dumps(question,indent=2)+'\n')
 print(path)
