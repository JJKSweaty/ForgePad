# Original curriculum

The JSON packages in this directory are original ForgePad exercises, released under CC0-1.0. The software is separately licensed under the root MIT license. No third-party interview questions are copied into this library.

There are twelve executable C/C++ questions and eight theory/design questions. `scripts/create_seed_questions.py` regenerates the packages. Reference implementations and hidden tests are authoring data: they are public in this repository, but excluded from the practice API. This is a study tool, not an assessment platform with secret test content.

Executable fixtures cover register masks, timer rollover, CRC-8, endian decoding, saturation, sequence wraparound, an ADC overflow bug, a bounded ring buffer, packet validation, fault-bit counting, C++ binary search, and simulated SPI transfers. A `boundary` category identifies the author's test intent; it is not a proof that every relevant edge case is covered.

The theory curriculum includes ISR synchronization, RTOS priority inversion, recoverable firmware updates, DMA/cache coherency, vector-table debugging, I2C recovery, Linux serial streams, and sensor pipeline design. The rubrics are criteria for review rather than automatic correctness scores.

Technical references for further study:

- [ARM documentation](https://developer.arm.com/documentation): use the exact core and MCU vendor manuals for target-specific behavior.
- [FreeRTOS documentation](https://www.freertos.org/Documentation/): kernel synchronization and scheduling.
- [Memfault Interrupt](https://interrupt.memfault.com/): debugging and firmware engineering articles.

The other interview resources listed in the project brief may be used for personal study; their question text is not redistributed here.
