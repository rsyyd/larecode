---
name: systematic-debugging
description: Debug a failing test, crash, or misbehavior by reproducing, minimizing, and finding the root cause before changing code.
version: 1.0.0
license: MIT
---

# Systematic Debugging

Stop guessing. Every fix must be earned by evidence.

## Steps

1. **Reproduce.** Run the failing case exactly as reported. If you cannot reproduce it, say so and gather more context; do not fix blind.
2. **Minimize.** Shrink the input, call path, or config until the failure is the smallest thing that still fails. A minimal repro usually names the bug.
3. **Read the actual error.** Full stack trace, full assertion diff, first bad value. Not the summary you assume it is.
4. **Hypothesize.** Write down one sentence: "X happens because Y." If you cannot state a falsifiable cause, keep reading code.
5. **Instrument.** Add a log, breakpoint expression, or focused assertion that distinguishes your hypothesis from the alternatives. Run it.
6. **Fix the root cause.** Patch where the invariant breaks, not where the symptom surfaces. One fix that covers all callers beats per-caller guards.
7. **Prove it.** The original repro now passes, and a regression test covering it exists. Re-run the surrounding suite, not just the one test.

## Traps

- Changing code before reproducing: you learn nothing and may hide the bug.
- Multiple edits at once: you cannot attribute the fix.
- Catching or suppressing the error to make the test pass.
- Fixing one caller when the same bug lives in five.

## Output

State the root cause in one paragraph, the fix in one sentence, and the command that proves it.
