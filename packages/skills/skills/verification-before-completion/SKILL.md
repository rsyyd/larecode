---
name: verification-before-completion
description: Verify work with fresh evidence before claiming anything is done, fixed, or passing.
version: 1.0.0
license: MIT
---

# Verification Before Completion

A claim without evidence is a guess. Before saying "done", "fixed", or "tests pass", produce the evidence.

## Required evidence

- **Tests pass**: run the suite now. Quote the summary line. A run from before your last edit does not count.
- **Build works**: run the build. Compilation errors are invisible until you compile.
- **The failure is gone**: for a bug fix, re-run the original reproduction, not just the suite.
- **Nothing else broke**: compare failures against the pre-change baseline if any existed. "Same failures as before" is a pass; different failures are not.

## Honest reporting

- If you did not run something, say you did not run it.
- If a step is flaky or skipped, say so.
- Do not soften: "should work", "probably fine", and "likely fixed" are not statuses.
- When a check fails, report it plainly with the output.

## Checklist

1. What did I change?
2. What command proves each change works?
3. Did I run those commands after my final edit?
4. What did I not verify, and does the user need to know?

If steps are missing, finish them before reporting. If they cannot be finished, report what remains.
