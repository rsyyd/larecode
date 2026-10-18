---
name: test-driven-development
description: Implement features and fix bugs test-first with a red-green-refactor loop, one behavior at a time.
version: 1.0.0
license: MIT
---

# Test-Driven Development

Write the test first. Watch it fail. Then make it pass. Then clean up.

## Loop

1. **Red.** Write one small test for the next behavior. Run it. It must fail, and fail for the expected reason (not a typo or a missing import). A test that passes immediately is testing existing behavior; rewrite it.
2. **Green.** Write the minimum code that makes the test pass. Run the test plus the surrounding suite.
3. **Refactor.** Remove duplication, improve names, simplify. Re-run; stay green.

## Rules

- One behavior per cycle. No "while I'm here" additions.
- The test asserts behavior, not implementation details. Renaming a function should not break it.
- Prefer real objects over mocks. Mock at process boundaries (network, clock, filesystem), not between your own classes.
- Bug fixes start with a failing test that reproduces the bug, then the fix.
- Never comment out, skip, or delete a test to get green. Fix the code or fix the test's premise deliberately.
- If the design resists a test, that is design feedback: simplify the interface.

## When it does not fit

Exploration and throwaway prototypes can skip the loop, but the moment code becomes load-bearing, backfill tests for its behavior before building on it.
