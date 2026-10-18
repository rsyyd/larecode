---
name: humanizer
description: Rewrite text to strip AI writing patterns (puffery, hedging, rule-of-three, em-dash punctuation) and restore a real voice.
version: 1.0.0
license: MIT
---

# Humanizer

Remove the statistical fingerprints of language models from prose. Apply to any user-facing text you write: docs, commit messages, release notes, emails, summaries.

## Rewrite pass

1. Read the text once and mark the patterns below.
2. Rewrite the marked sections with plain constructions.
3. Preserve meaning and tone. Match the user's voice when they provided a sample.
4. Read the result aloud in your head. If a sentence sounds like a brochure, rewrite it.

## Patterns to remove

- **Puffery**: "robust", "seamless", "powerful", "cutting-edge", "game-changing". Name the concrete property instead.
- **Empty intensifiers**: really, very, truly, quite, just, simply, easy. Delete or replace with the fact.
- **Rule of three padding**: three adjectives or clauses where one carries the meaning. Cut to one.
- **"Not just X, but Y"**: a template, not a sentence. Say the point directly.
- **Hedge stacking**: "it's worth noting that it might potentially". One qualifier at most, or none.
- **Transition clutter**: "Moreover", "Furthermore", "In conclusion". If the link is real, a shorter word works; if it is not, delete.
- **Summary redundancy**: a paragraph restating the paragraph above. Delete the restatement.
- **Symmetry fetish**: every list item the same length, every section the same shape. Vary where the content varies.

## Hard style rules

- No em-dash as punctuation. Use a comma, colon, or a new sentence.
- Straight quotes only, no curly quotes.
- Active voice by default; passive only when the actor is unknown or irrelevant.
- Prefer concrete numbers over vague scale words: "cuts 40ms" beats "significantly faster".
- Short sentences for facts, longer ones for reasoning. Uniform rhythm reads machine-made.

## Before finishing

Ask: what still marks this as generated? Fix the top two answers, then stop.
