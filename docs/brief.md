# Madlan — Tech Challenge

Attached is a CSV of Israeli residential property deals.

**Build something genuinely useful with it and an LLM. Deploy it. Send us the URL.**

What "useful" means is your call. Deciding that is part of what we're evaluating.

---

## Constraints

These are non-negotiable. Everything else is open.

1. **Live and public.** A URL we can open. Not localhost, not a video.
2. **Hebrew, RTL.** It's our product's native condition.
3. **The LLM does real work.** Not a wrapper around a summary.
4. **Assume 10,000 requests a day, on your budget.** Design for it. Know what it costs.
5. **It must not state things the data doesn't support.**
6. **It must survive the model being slow, wrong, or unavailable.**
7. **Build it with AI assistance.** We do. Keep a short log of how you worked — including at least
   one time it gave you a bad answer and you caught it.

---

## Time

**~5 focused hours of work. 3 days to deliver.If you finish before, feel free to deliver earlier.** 
If the deadline is awkward, say so and we'll move
it — that's not a test.

We'd rather see one thing done with real thought than four things done fast. If you cut something,
tell us what and why.

---

## About the data, and the gaps

The data is real-world shaped. We haven't cleaned it, and we're not going to tell you what's wrong
with it.

We've also deliberately left parts of this brief unspecified. Some of what you need isn't in the
CSV at all.

Handle it however an R&D Ops engineer would: decide and document, or ask us. Both are good answers.
Asking is a positive signal, not a weakness — you can reach us any time during the three days. The
only bad outcome is being stuck quietly.

---

## The session — 40 minutes, in English, with R&D and Product

**Demo — 5 min.** Show it working. Tell us what you chose to build and why.

**Architecture — 15 min.** A diagram, and the reasoning behind it. Be ready on:

- What you send the model, what you compute yourself, and why that line is where it is
- Token and cost economics at 10k/day — what you cache, what you precompute, what you'd change at 10×
- How you keep it from inventing facts, and how the user can tell what's grounded
- What happens when the model fails, is slow, or returns something unexpected
- What you'd rebuild first if this became a real Madlan feature

**Teach it — 10 min.** Pick one technical area from your build and explain it to us as you would to
a junior developer on your team. Assume they're smart and don't know the topic. Half this role is
raising the level of the people around you, so we're watching the teaching as closely as the
engineering.

**Q&A — 10 min.**

---

## What we're looking for

Creativity and product instinct. Senior-level decisions you can defend — including the ones your AI
assistant made for you. How you handle missing information. Whether you can make a hard thing sound
simple.

Your work stays yours. This is for evaluation only.

Good luck — we're curious what you come up with.
My email if needed for questions: asafr@madlan.co.il
