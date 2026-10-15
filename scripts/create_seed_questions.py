"""Rebuild the original CC0 sample question packages. Does not execute C/C++."""
import json
from pathlib import Path

DEST = Path(__file__).resolve().parents[1] / "questions"
SOURCE = {"name": "ForgePad original curriculum", "url": "", "license": "CC0-1.0"}


def question(slug, title, topics, prompt, constraints, starter, reference, cases,
             difficulty="intermediate", language="c", follow_ups=None, hints=None,
             kind="coding", minutes=20):
    tests = []
    for index, (name, category, body, expected) in enumerate(cases):
        tests.append({"id": f"t{index + 1}", "name": name,
                      "visibility": "public" if index < 2 else "hidden",
                      "category": category, "stdin": "", "expected_stdout": expected,
                      "fixture": body})
    package = {
        "schema_version": "1.0", "id": slug, "version": 1, "title": title,
        "description": prompt.split("\n")[0], "type": kind,
        "difficulty": difficulty, "topics": topics, "duration_minutes": minutes,
        "language": language, "prompt": prompt, "constraints": constraints,
        "starter_files": starter,
        "test_config": {"mode": "fixture", "compiler": "gcc", "sanitizers": False,
                        "timeout_seconds": 2, "tests": tests} if cases else None,
        "reference_solution": reference,
        "rubric": ["Respect the stated contract and bounds.",
                   "Explain integer widths, ownership, and relevant edge cases.",
                   "Separate host-test evidence from hardware guarantees."],
        "follow_ups": follow_ups or ["Which boundary conditions would you test on the target?",
                                     "What changes if the function is called from an ISR?"],
        "hints": hints or ["Write down the boundary cases before choosing an implementation.",
                            "Use explicit integer widths and keep intermediate values in range."],
        "source": SOURCE,
    }
    (DEST / f"{slug}.json").write_text(json.dumps(package, indent=2) + "\n")


def c_fixture(declaration, body):
    return "#include <stdint.h>\n#include <stddef.h>\n#include <stdio.h>\n#include <limits.h>\n" + declaration + "\nint main(void) {\n" + body + "\nreturn 0;\n}\n"


def scalar_cases(decl, exprs, fmt="%u", cast="unsigned"):
    return [(name, category, c_fixture(decl, f'printf("{fmt}\\n", ({cast})({expr}));'), expected + "\n")
            for name, category, expr, expected in exprs]


def main():
    DEST.mkdir(exist_ok=True)
    question("register-field", "Update a register field", ["bit operations", "registers", "embedded C"],
             "Implement uint32_t update_field(uint32_t reg, uint32_t mask, uint32_t value).\nReplace only the bits selected by mask with the corresponding bits from value. value is already shifted to its register position. This operates on a value, not a volatile peripheral address.",
             ["Preserve every bit outside mask.", "No shifts, heap allocation, or peripheral access are necessary."],
             {"solution.c": "#include <stdint.h>\nuint32_t update_field(uint32_t reg, uint32_t mask, uint32_t value) {\n    return reg;\n}\n"},
             {"solution.c": "#include <stdint.h>\nuint32_t update_field(uint32_t reg, uint32_t mask, uint32_t value) { return (reg & ~mask) | (value & mask); }\n"},
             scalar_cases("uint32_t update_field(uint32_t, uint32_t, uint32_t);", [
                 ("Replace low nibble", "normal", "update_field(0xA5, 0x0F, 0x0C)", "172"),
                 ("Empty mask", "boundary", "update_field(0x12345678, 0, UINT32_MAX)", "305419896"),
                 ("Full mask", "boundary", "update_field(0, UINT32_MAX, UINT32_MAX)", "4294967295"),
                 ("Ignore value outside mask", "normal", "update_field(0x80, 0x0F, 0xF3)", "131")]), difficulty="beginner", minutes=10,
             follow_ups=["Why can a read-modify-write be unsafe on a hardware status register?", "How would write-one-to-clear bits change this API?"])

    question("timer-rollover", "Measure elapsed time across rollover", ["timers", "integer arithmetic", "wraparound"],
             "Implement int deadline_reached(uint32_t now, uint32_t start, uint32_t interval).\nReturn 1 when at least interval ticks have elapsed since start, otherwise 0. now and start are readings of one wrapping 32-bit counter. The actual elapsed duration is less than 2^32 ticks.",
             ["The timer wraps from UINT32_MAX to zero.", "interval is a 32-bit unsigned value.", "Do not compare now against start + interval."],
             {"solution.c": "#include <stdint.h>\nint deadline_reached(uint32_t now, uint32_t start, uint32_t interval) {\n    return 0;\n}\n"},
             {"solution.c": "#include <stdint.h>\nint deadline_reached(uint32_t now, uint32_t start, uint32_t interval) { return (uint32_t)(now - start) >= interval; }\n"},
             scalar_cases("int deadline_reached(uint32_t, uint32_t, uint32_t);", [
                 ("Before deadline", "normal", "deadline_reached(109, 100, 10)", "0"),
                 ("At deadline", "boundary", "deadline_reached(110, 100, 10)", "1"),
                 ("Rollover", "boundary", "deadline_reached(3, UINT32_MAX - 4, 8)", "1"),
                 ("Zero interval", "boundary", "deadline_reached(7, 7, 0)", "1"),
                 ("Before wrapped deadline", "normal", "deadline_reached(2, UINT32_MAX - 4, 8)", "0")]),
             follow_ups=["What if this function is not called for an entire timer period?", "How would you convert milliseconds to ticks without overflowing?"])

    crc_decl = "uint8_t crc8(const uint8_t *, size_t);"
    question("crc8-atm", "CRC-8 for a sensor frame", ["CRC", "protocols", "byte buffers"],
             "Implement uint8_t crc8(const uint8_t *data, size_t len).\nUse CRC-8/SMBUS parameters: polynomial 0x07, initial value zero, no reflection, and final XOR zero. Process each byte most-significant bit first.",
             ["data may be NULL only when len is zero.", "No lookup table or heap allocation.", "Return zero for an empty message."],
             {"solution.c": "#include <stdint.h>\n#include <stddef.h>\nuint8_t crc8(const uint8_t *data, size_t len) {\n    return 0;\n}\n"},
             {"solution.c": "#include <stdint.h>\n#include <stddef.h>\nuint8_t crc8(const uint8_t *data, size_t len) { uint8_t crc = 0; for(size_t i=0;i<len;i++){ crc ^= data[i]; for(int b=0;b<8;b++) crc = (uint8_t)((crc & 0x80) ? (crc << 1) ^ 0x07 : crc << 1); } return crc; }\n"},
             [("Check vector", "normal", c_fixture(crc_decl, 'const uint8_t x[]="123456789"; printf("%u\\n", (unsigned)crc8(x,9));'), "244\n"),
              ("Empty frame", "boundary", c_fixture(crc_decl, 'printf("%u\\n", (unsigned)crc8(NULL,0));'), "0\n"),
              ("Single high byte", "boundary", c_fixture(crc_decl, 'const uint8_t x[]={255}; printf("%u\\n", (unsigned)crc8(x,1));'), "243\n"),
              ("Short binary frame", "normal", c_fixture(crc_decl, 'const uint8_t x[]={1,2,3}; printf("%u\\n", (unsigned)crc8(x,3));'), "72\n")], minutes=25,
             follow_ups=["What classes of corruption does a CRC detect, and what does it not authenticate?", "How would you make the CRC incremental across DMA chunks?"])

    question("little-endian-read", "Decode a bounded little-endian field", ["endianness", "bounds checking", "binary formats"],
             "Implement int read_le16(const uint8_t *buf, size_t len, size_t offset, uint16_t *out).\nDecode two bytes at offset into out and return 1. If fewer than two bytes remain, return 0 and leave out unchanged. buf may be NULL when len is zero; out is always valid.",
             ["Avoid unaligned pointer casts.", "offset may be SIZE_MAX.", "Check bounds without overflowing offset + 2."],
             {"solution.c": "#include <stdint.h>\n#include <stddef.h>\nint read_le16(const uint8_t *buf, size_t len, size_t offset, uint16_t *out) {\n    return 0;\n}\n"},
             {"solution.c": "#include <stdint.h>\n#include <stddef.h>\nint read_le16(const uint8_t *buf, size_t len, size_t offset, uint16_t *out) { if(offset > len || len-offset < 2) return 0; *out=(uint16_t)((uint16_t)buf[offset] | ((uint16_t)buf[offset+1]<<8)); return 1; }\n"},
             [("Decode at offset", "normal", c_fixture("int read_le16(const uint8_t *, size_t, size_t, uint16_t *);", 'uint8_t b[]={0,0x34,0x12}; uint16_t v=99; int ok=read_le16(b,3,1,&v); printf("%d %u\\n",ok,(unsigned)v);'), "1 4660\n"),
              ("Truncated field", "negative", c_fixture("int read_le16(const uint8_t *, size_t, size_t, uint16_t *);", 'uint8_t b[]={1}; uint16_t v=99; int ok=read_le16(b,1,0,&v); printf("%d %u\\n",ok,(unsigned)v);'), "0 99\n"),
              ("Overflowing offset", "boundary", c_fixture("int read_le16(const uint8_t *, size_t, size_t, uint16_t *);", 'uint16_t v=99; int ok=read_le16(NULL,0,SIZE_MAX,&v); printf("%d %u\\n",ok,(unsigned)v);'), "0 99\n"),
              ("Maximum field", "boundary", c_fixture("int read_le16(const uint8_t *, size_t, size_t, uint16_t *);", 'uint8_t b[]={255,255}; uint16_t v=0; int ok=read_le16(b,2,0,&v); printf("%d %u\\n",ok,(unsigned)v);'), "1 65535\n")])

    question("saturating-add", "Saturating sensor arithmetic", ["integer arithmetic", "undefined behavior", "signal processing"],
             "Implement int16_t saturating_add(int16_t a, int16_t b).\nReturn the mathematical sum clamped to the signed 16-bit range.",
             ["Do not depend on signed overflow or implementation-defined narrowing.", "INT16_MIN and INT16_MAX are valid inputs."],
             {"solution.c": "#include <stdint.h>\nint16_t saturating_add(int16_t a, int16_t b) {\n    return 0;\n}\n"},
             {"solution.c": "#include <stdint.h>\n#include <limits.h>\nint16_t saturating_add(int16_t a, int16_t b) { int32_t s=(int32_t)a+b; if(s>INT16_MAX) return INT16_MAX; if(s<INT16_MIN) return INT16_MIN; return (int16_t)s; }\n"},
             scalar_cases("int16_t saturating_add(int16_t, int16_t);", [
                 ("Normal sum", "normal", "saturating_add(1000, -300)", "700"),
                 ("Positive saturation", "boundary", "saturating_add(INT16_MAX, 1)", "32767"),
                 ("Negative saturation", "boundary", "saturating_add(INT16_MIN, -1)", "-32768"),
                 ("Opposite extremes", "normal", "saturating_add(INT16_MIN, INT16_MAX)", "-1"),
                 ("Two minima", "boundary", "saturating_add(INT16_MIN, INT16_MIN)", "-32768")], "%d", "int"), difficulty="beginner", minutes=15)

    question("sequence-window", "Compare wrapping packet sequences", ["protocols", "wraparound", "integer arithmetic"],
             "Implement int sequence_is_newer(uint16_t candidate, uint16_t previous).\nReturn 1 exactly when the forward modular distance from previous to candidate is in [1, 32767]. Equal values and the ambiguous half-range distance 32768 return 0.",
             ["Sequence numbers wrap modulo 65536.", "Use unsigned arithmetic; do not rely on narrowing to a signed type."],
             {"solution.c": "#include <stdint.h>\nint sequence_is_newer(uint16_t candidate, uint16_t previous) {\n    return 0;\n}\n"},
             {"solution.c": "#include <stdint.h>\nint sequence_is_newer(uint16_t candidate, uint16_t previous) { uint16_t d=(uint16_t)((uint32_t)candidate + 65536u - previous); return d != 0 && d < 32768u; }\n"},
             scalar_cases("int sequence_is_newer(uint16_t, uint16_t);", [
                 ("Next packet", "normal", "sequence_is_newer(11, 10)", "1"),
                 ("Equal packet", "boundary", "sequence_is_newer(10, 10)", "0"),
                 ("Wrap forward", "boundary", "sequence_is_newer(0, 65535)", "1"),
                 ("Old packet", "normal", "sequence_is_newer(65535, 0)", "0"),
                 ("Ambiguous half range", "boundary", "sequence_is_newer(32768, 0)", "0")]))

    question("adc-average", "Repair an overflowing ADC average", ["ADC", "debugging", "integer arithmetic"],
             "Repair uint16_t adc_average(const uint16_t *samples, size_t n).\nA board reports unexpectedly small averages at high input voltage. The current accumulator is only 16 bits. Return the integer mean rounded down, or zero when n is zero. All samples are unsigned 16-bit values and n is at most 65535.",
             ["samples may be NULL when n is zero.", "No floating point or heap allocation.", "Explain why your accumulator is sufficiently wide."],
             {"solution.c": "#include <stdint.h>\n#include <stddef.h>\nuint16_t adc_average(const uint16_t *samples, size_t n) {\n    uint16_t sum = 0;\n    for (size_t i = 0; i < n; ++i) sum += samples[i];\n    return (uint16_t)(sum / n);\n}\n"},
             {"solution.c": "#include <stdint.h>\n#include <stddef.h>\nuint16_t adc_average(const uint16_t *samples, size_t n) { if(!n) return 0; uint32_t sum=0; for(size_t i=0;i<n;i++) sum+=samples[i]; return (uint16_t)(sum/n); }\n"},
             [("Normal readings", "normal", c_fixture("uint16_t adc_average(const uint16_t *, size_t);", 'uint16_t x[]={100,200,301}; printf("%u\\n",(unsigned)adc_average(x,3));'), "200\n"),
              ("Empty batch", "boundary", c_fixture("uint16_t adc_average(const uint16_t *, size_t);", 'printf("%u\\n",(unsigned)adc_average(NULL,0));'), "0\n"),
              ("Full scale", "boundary", c_fixture("uint16_t adc_average(const uint16_t *, size_t);", 'uint16_t x[]={65535,65535,65535}; printf("%u\\n",(unsigned)adc_average(x,3));'), "65535\n"),
              ("Maximum batch", "boundary", c_fixture("uint16_t adc_average(const uint16_t *, size_t);", 'static uint16_t x[65535]; for(size_t i=0;i<65535;i++) x[i]=65535; printf("%u\\n",(unsigned)adc_average(x,65535));'), "65535\n")], kind="debugging")

    ring_header = "#ifndef RING_H\n#define RING_H\n#include <stdint.h>\n#include <stddef.h>\ntypedef struct { uint8_t data[4]; size_t head, tail, count; } Ring;\nvoid ring_init(Ring *r);\nint ring_push(Ring *r, uint8_t value);\nint ring_pop(Ring *r, uint8_t *out);\n#endif\n"
    ring_ref = '#include "ring.h"\nvoid ring_init(Ring *r){r->head=r->tail=r->count=0;}\nint ring_push(Ring *r,uint8_t v){if(r->count==4)return 0;r->data[r->head]=v;r->head=(r->head+1)%4;r->count++;return 1;}\nint ring_pop(Ring *r,uint8_t *out){if(!r->count)return 0;*out=r->data[r->tail];r->tail=(r->tail+1)%4;r->count--;return 1;}\n'
    ring_decl = ring_header.replace('#ifndef RING_H\n#define RING_H\n', '').replace('#endif\n', '')
    question("bounded-ring", "Build a bounded byte ring", ["UART", "ring buffers", "bounded memory"],
             "Implement the Ring functions declared in ring.h.\nThe ring stores exactly four bytes in FIFO order. push returns 0 when full without modifying the queue. pop returns 0 when empty and leaves out unchanged. init resets the queue. This exercise is single-threaded; the tests do not establish ISR safety.",
             ["Use the provided struct without dynamic allocation.", "Use all four storage slots.", "All pointers are valid.", "Return 1 on a successful push or pop."],
             {"ring.h": ring_header, "solution.c": '#include "ring.h"\nvoid ring_init(Ring *r) { r->head = r->tail = r->count = 0; }\nint ring_push(Ring *r, uint8_t value) { return 0; }\nint ring_pop(Ring *r, uint8_t *out) { return 0; }\n'},
             {"ring.h": ring_header, "solution.c": ring_ref},
             [("FIFO order", "normal", c_fixture(ring_decl, 'Ring r; ring_init(&r); uint8_t v=0; ring_push(&r,10); ring_push(&r,20); ring_pop(&r,&v); printf("%u ",(unsigned)v); ring_pop(&r,&v); printf("%u\\n",(unsigned)v);'), "10 20\n"),
              ("Empty leaves output intact", "boundary", c_fixture(ring_decl, 'Ring r; ring_init(&r); uint8_t v=99; int ok=ring_pop(&r,&v); printf("%d %u\\n",ok,(unsigned)v);'), "0 99\n"),
              ("Full rejects new byte", "negative", c_fixture(ring_decl, 'Ring r; ring_init(&r); for(int i=1;i<=4;i++)printf("%d",ring_push(&r,(uint8_t)i)); printf("%d\\n",ring_push(&r,5)); uint8_t v; while(ring_pop(&r,&v))printf("%u ",(unsigned)v); printf("\\n");'), "11110\n1 2 3 4 \n"),
              ("Repeated wrap", "boundary", c_fixture(ring_decl, 'Ring r; ring_init(&r); uint8_t v=0; int ok=1; for(int i=0;i<100;i++){if(!ring_push(&r,(uint8_t)i)||!ring_pop(&r,&v)||v!=(uint8_t)i)ok=0;} printf("%d %zu\\n",ok,r.count);'), "1 0\n")], minutes=30,
             follow_ups=["Which state is shared by an ISR producer and a task consumer?", "Does volatile make count++ atomic?", "How could separate producer and consumer indices avoid a shared count?", "How would you measure and report overflow under burst traffic?"])

    question("frame-checksum", "Validate a length-prefixed frame", ["packet parsing", "bounds checking", "protocols"],
             "Implement int valid_frame(const uint8_t *buf, size_t len).\nA frame has one payload-length byte N, then N payload bytes, then one checksum byte. The checksum equals the sum of payload bytes modulo 256. Accept exactly N + 2 bytes and reject truncated or trailing data. A zero-length payload is valid with checksum zero.",
             ["buf may be NULL when len is zero.", "Never read a byte before checking it is present.", "Return exactly 0 or 1."],
             {"solution.c": "#include <stdint.h>\n#include <stddef.h>\nint valid_frame(const uint8_t *buf, size_t len) { return 0; }\n"},
             {"solution.c": "#include <stdint.h>\n#include <stddef.h>\nint valid_frame(const uint8_t *b,size_t len){if(len<2)return 0;size_t n=b[0];if(len!=n+2)return 0;uint8_t s=0;for(size_t i=0;i<n;i++)s=(uint8_t)(s+b[i+1]);return s==b[n+1];}\n"},
             [("Valid payload", "normal", c_fixture("int valid_frame(const uint8_t *,size_t);", 'uint8_t x[]={3,10,20,30,60}; printf("%d\\n",valid_frame(x,5));'), "1\n"),
              ("Empty payload", "boundary", c_fixture("int valid_frame(const uint8_t *,size_t);", 'uint8_t x[]={0,0}; printf("%d\\n",valid_frame(x,2));'), "1\n"),
              ("Truncated input", "negative", c_fixture("int valid_frame(const uint8_t *,size_t);", 'uint8_t x[]={3,10}; printf("%d %d\\n",valid_frame(x,2),valid_frame(NULL,0));'), "0 0\n"),
              ("Bad checksum", "negative", c_fixture("int valid_frame(const uint8_t *,size_t);", 'uint8_t x[]={1,10,11}; printf("%d\\n",valid_frame(x,3));'), "0\n"),
              ("Modulo checksum", "boundary", c_fixture("int valid_frame(const uint8_t *,size_t);", 'uint8_t x[]={2,255,2,1}; printf("%d\\n",valid_frame(x,4));'), "1\n")])

    question("popcount32", "Count active fault flags", ["bit operations", "DSA", "fault handling"],
             "Implement unsigned count_faults(uint32_t flags).\nEach set bit represents an active fault. Return the number of set bits in the complete 32-bit value.",
             ["No compiler popcount intrinsic.", "Do not shift a signed integer into its sign bit."],
             {"solution.c": "#include <stdint.h>\nunsigned count_faults(uint32_t flags) { return 0; }\n"},
             {"solution.c": "#include <stdint.h>\nunsigned count_faults(uint32_t flags){unsigned n=0;while(flags){flags&=flags-1;n++;}return n;}\n"},
             scalar_cases("unsigned count_faults(uint32_t);", [
                 ("Sparse faults", "normal", "count_faults(0x10101)", "3"),
                 ("No faults", "boundary", "count_faults(0)", "0"),
                 ("Every fault", "boundary", "count_faults(UINT32_MAX)", "32"),
                 ("Highest bit", "boundary", "count_faults(UINT32_C(0x80000000))", "1")]), difficulty="beginner", minutes=10)

    cpp_header = "#ifndef WINDOW_HPP\n#define WINDOW_HPP\n#include <cstddef>\nint lower_bound_sample(const int* values, std::size_t n, int target);\n#endif\n"
    cpp_tests = []
    for name, cat, values, target, expected in [("Between samples", "normal", "1,4,8,12", 6, "2"), ("Empty sample set", "boundary", "", 0, "0"), ("Duplicate values", "normal", "2,2,2,3", 2, "0"), ("Past last sample", "boundary", "1,3,5", 8, "3")]:
        setup = f"const int v[]={{{values}}};" if values else "const int* v=nullptr;"
        size = len(values.split(",")) if values else 0
        cpp_tests.append((name,cat,"#include <cstddef>\n#include <cstdio>\nint lower_bound_sample(const int*,std::size_t,int);\nint main(){"+setup+f' std::printf("%d\\n",lower_bound_sample(v,{size},{target}));' + "}\n",expected+"\n"))
    question("sample-lower-bound", "Search a sorted sample table", ["C++", "binary search", "DSA"],
             "Implement int lower_bound_sample(const int* values, std::size_t n, int target).\nReturn the first index whose value is at least target, or n when no such index exists. The array is sorted in nondecreasing order.",
             ["n is at most 100000.", "values may be nullptr when n is zero.", "Use O(log n) comparisons and O(1) additional memory.", "Do not call std::lower_bound."],
             {"window.hpp": cpp_header, "solution.cpp": '#include "window.hpp"\nint lower_bound_sample(const int* values, std::size_t n, int target) { return 0; }\n'},
             {"window.hpp": cpp_header, "solution.cpp": '#include "window.hpp"\nint lower_bound_sample(const int* v,std::size_t n,int target){std::size_t lo=0,hi=n;while(lo<hi){auto m=lo+(hi-lo)/2;if(v[m]<target)lo=m+1;else hi=m;}return static_cast<int>(lo);}\n'},
             cpp_tests, language="cpp", minutes=20,
             follow_ups=["Do passing functional tests establish logarithmic complexity?", "What if DMA can modify the table while it is being searched?"])

    spi_header = "#ifndef SENSOR_H\n#define SENSOR_H\n#include <stdint.h>\nuint8_t spi_transfer(uint8_t value);\nvoid chip_select(int active);\nuint16_t read_sensor(void);\n#endif\n"
    spi_fixture = '#include <stdio.h>\n#include <stdint.h>\nuint16_t read_sensor(void);\nstatic unsigned i; static int active; static int bad; static unsigned tx[3];\nvoid chip_select(int x){ if(x==active)bad=1; active=x; }\nuint8_t spi_transfer(uint8_t v){if(!active||i>=3){bad=1;return 0;}tx[i]=v;const uint8_t response[]={0,HI,LO};return response[i++];}\nint main(void){uint16_t v=read_sensor();printf("%u %u %u %u %u %d %d\\n",(unsigned)v,i,tx[0],tx[1],tx[2],active,bad);}\n'
    question("spi-sensor", "Read a sensor through a simulated SPI bus", ["SPI", "drivers", "test doubles"],
             "Implement uint16_t read_sensor(void) using the functions in sensor.h.\nAssert chip select with chip_select(1), send command 0x80, clock the high and low result bytes by sending two zero bytes, then deassert chip select with chip_select(0). Discard the response to the command. Return the big-endian 16-bit sample.",
             ["Exactly three transfers while chip select is asserted.", "The bus is synchronous and infallible for this exercise.", "This simulated transaction log does not test electrical timing or SPI mode."],
             {"sensor.h": spi_header, "solution.c": '#include "sensor.h"\nuint16_t read_sensor(void) { return 0; }\n'},
             {"sensor.h": spi_header, "solution.c": '#include "sensor.h"\nuint16_t read_sensor(void){chip_select(1);(void)spi_transfer(0x80);uint8_t hi=spi_transfer(0);uint8_t lo=spi_transfer(0);chip_select(0);return (uint16_t)(((uint16_t)hi<<8)|lo);}\n'},
             [("Typical sample", "normal", spi_fixture.replace("HI", "0x12").replace("LO", "0x34"), "4660 3 128 0 0 0 0\n"),
              ("Zero sample", "boundary", spi_fixture.replace("HI", "0").replace("LO", "0"), "0 3 128 0 0 0 0\n"),
              ("Full-scale sample", "boundary", spi_fixture.replace("HI", "255").replace("LO", "255"), "65535 3 128 0 0 0 0\n")], minutes=20)

    theory = [
        ("volatile-atomicity", "A volatile counter shared with an ISR", ["volatile", "atomics", "interrupts"], "A 1 kHz interrupt increments a volatile uint32_t counter while a foreground task reads and resets it. Is this safe? Explain the distinct roles of compiler visibility, indivisible accesses, and synchronization. Propose a design and state what target-specific facts you need.", ["Do not assume volatile creates an atomic read-modify-write.", "Explain the lost-update interleaving.", "Discuss a bounded critical section or suitable lock-free atomic operation and ISR constraints."], ["What changes for a 64-bit counter on a 32-bit MCU?", "Can disabling interrupts on one core protect against a second core?"]),
        ("priority-inversion", "Diagnose a blocked high-priority task", ["RTOS", "priority inversion", "mutexes"], "A high-priority control task waits for a mutex held by a low-priority logging task. An unrelated medium-priority task runs continuously. Explain the failure and discuss priority inheritance, lock duration, and whether a semaphore is an equivalent replacement.", ["Identify the medium task delaying the mutex owner.", "Describe priority inheritance and its limits.", "Discuss bounded critical sections and avoiding blocking I/O under the mutex."], ["What happens with nested mutexes?", "How would you measure worst-case blocking on the target?"]),
        ("boot-power-loss", "Design a power-loss-safe firmware update", ["bootloaders", "flash", "fault handling"], "Design a firmware update flow for an MCU with two image slots and power loss possible at any instruction. Describe image validation, boot metadata, the first boot of a new image, confirmation, and rollback. State your flash programming assumptions.", ["Preserve a known bootable image until replacement is verified.", "Distinguish corruption detection from image authenticity.", "Make metadata updates recoverable and discuss failed trial boots."], ["How would you inject power failure during testing?", "How does a monotonic anti-rollback counter complicate recovery?"]),
        ("dma-cache", "DMA completes but the buffer looks stale", ["DMA", "caches", "memory ordering"], "A Cortex-M system with data cache receives a DMA completion interrupt, but the CPU reads old bytes from the destination buffer. Diagnose possible causes and propose a buffer ownership and cache-maintenance policy. Assume the DMA engine is not cache coherent.", ["Describe separate CPU cache and memory views.", "Discuss cache-line alignment and avoiding unrelated dirty data in maintained lines.", "Describe direction-specific clean/invalidate operations and barriers using target documentation."], ["What changes for a transmit DMA transfer?", "Can volatile fix cache coherency?"]),
        ("vector-table", "An interrupt lands in the default handler", ["MCU architecture", "vector tables", "debugging"], "After relocating an application behind a bootloader, a UART interrupt enters the default handler. Provide an ordered investigation using the linker map, vector table address, handler symbol, interrupt number, and debugger register inspection.", ["Verify the active vector table base where supported.", "Check exact handler symbol and weak alias resolution.", "Check interrupt index, enable state, and pending status without assuming one MCU's register layout."], ["What should be checked before jumping from bootloader to application?", "How could a C++ linkage mismatch produce this symptom?"]),
        ("i2c-stuck-low", "Recover an I2C bus with SDA held low", ["I2C", "hardware debugging", "fault handling"], "An I2C transaction sometimes stalls after a sensor reset. A logic analyzer shows SDA low while SCL is high. Plan a diagnosis and a bounded recovery policy. Include pull-ups, bus ownership, target documentation, and escalation when recovery fails.", ["Distinguish a controller state issue from an external device holding the line.", "Inspect electrical levels, pull-ups, and reset/power sequencing.", "Use documented recovery with timeouts; do not drive against a device holding a line."], ["How would multiple bus controllers affect recovery?", "What information should the driver report after a timeout?"]),
        ("linux-serial", "Handle partial reads from a Linux serial port", ["embedded Linux", "serial communication", "processes"], "A Linux service assumes each read() returns one complete UART packet. Explain why this fails and design a bounded incremental parser with timeout handling and reconnection. Address short reads, EINTR, nonblocking I/O, and malformed input.", ["Treat the serial port as a byte stream.", "Retain incomplete state with bounded memory and framing rules.", "Differentiate transient errors, EOF/device removal, and protocol errors."], ["How would you test without physical hardware?", "How do termios settings affect this design?"]),
        ("sensor-pipeline", "Design a bounded sensor pipeline", ["embedded design", "real-time constraints", "bounded memory"], "Design a system sampling eight 16-bit channels at 2 kHz and sending batches over a link that can stall for 100 ms. Specify buffering, timestamps, ownership, overload behavior, and observability. Account for metadata and explain which deadlines need measurement.", ["Calculate raw throughput and minimum payload buffering for a stated stall window.", "Define backpressure or an explicit drop policy and record losses.", "Discuss DMA ownership, timestamp rollover, and bounded processing budgets."], ["What changes when the link stalls indefinitely?", "How would you partition work between ISR and task context?"]),
    ]
    for slug, title, topics, prompt, rubric, followups in theory:
        question(slug,title,topics,prompt,["State assumptions and separate measurements from guarantees."],{}, {}, [],kind="design" if slug in {"boot-power-loss","sensor-pipeline"} else "theory", language="independent", minutes=10,follow_ups=followups)
        path=DEST / f"{slug}.json"
        package=json.loads(path.read_text())
        package["rubric"]=rubric
        path.write_text(json.dumps(package,indent=2)+"\n")


if __name__ == "__main__":
    main()
