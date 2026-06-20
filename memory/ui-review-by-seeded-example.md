---
name: ui-review-by-seeded-example
description: How Tejas wants UI work delivered and reviewed
metadata:
  type: feedback
---

Tejas reviews UI work by *feel*, using a seeded demo fixture that matches the design mockups already agreed during planning — not a fresh cold example. He prefers large UI builds delivered in reviewable batches with checkpoints, not one big dump.

**Why:** The point of a UI review checkpoint is judging feel (e.g. does the decisions screen's ask-first framing land, does generated reasoning sound like Sherpa, does the tradeoff copy feel earned) — not verifying API plumbing. A seeded example matching prior mockups lets him compare directly against what was reviewed, and click through repeatedly without paying for an LLM call on every reload.

**How to apply:** When building screens, seed a demo fixture that matches the design examples (for Sherpa: Portugal 14 days — Lisbon/Porto split, Algarve cut, Douro skip, rest day), keep the live LLM path available too (for checking quality on a genuinely new input), and split big UI work into batches with a review pause between. See [[sherpa-rebuild-judgment-engine]].
