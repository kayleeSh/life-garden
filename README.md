# Life Garden

An AI-driven growth visualization — four flowers, each representing a life domain (Sleep, Fitness, Study, Career), that bloom, wilt, and cross-influence each other based on a simulated 90-day history.

This isn't a habit tracker. The goal isn't "did you do the thing today" — it's showing *why* a domain is thriving or struggling, including effects that aren't obvious from a single metric (e.g. a domain's effort stays constant but it still visibly weakens because sleep quality dropped and dragged the whole garden's "soil" down with it).

## [**▶ Live demo**](https://kayleesh.github.io/life-garden/garden.html)

## View it

Click the live demo link above, or open [`garden.html`](garden.html) directly in a browser — no build step, no server needed either way. It's a single self-contained file (Three.js loaded from CDN).

- Drag the scrubber (bottom-left) to jump to any of the 90 simulated days, or let it autoplay
- Hover over petals for a lift/glow response
- The legend (top-right) shows each flower's current growth stage and vitality
- The caption (bottom-right) is a rule-based "insight" generated from that day's data — the actual differentiator from a plain tracker

## How it works

**The growth model** (`lib/growthEngine.js`) is a small, pure, dependency-free engine:

- Each domain gets a daily **score** (0–1) from its own scorer function — e.g. sleep duration/deep-sleep%, steps/active-minutes normalized against a rolling personal baseline, study minutes + session spread, career events (commits, ships, offers)
- That score feeds a **vitality** value via exponential smoothing (`vitality = vitality·decay + score·(1-decay)`) — consistency beats one big spike, and each domain's `decay` controls how fast it forgets (Sleep reacts in days, Career reflects months)
- Vitality maps to a **life-cycle stage** (`seed → sprout → leaf → bud → bloom → fruit`) with hysteresis bands so it doesn't flicker, and `fruit` requires sustained bloom, not just a score crossing
- **Sleep is a foundation domain**: its vitality feeds a shared `soilMoisture` value that throttles how much *every other* domain can grow — the mechanism behind "your effort didn't change, but the flower still weakened"
- Career is an **impulse domain** (sparse events, not a daily flow) — it jumps on an event and slowly fades, rather than being diluted into near-zero by daily averaging like the flow domains

**Synthetic data** (`lib/syntheticHistory.js`) fabricates a plausible 90-day arc (30 good days → 21-day sleep dip → 39-day recovery, with career events at day 10/45/80) so the story is demonstrable without any real integration. See [`schema/synthetic-signals.schema.json`](schema/synthetic-signals.schema.json) for the exact data contract — a real integration (Apple Health, GitHub, Notion...) would just need to produce the same shape.

**The visualization** (`garden.html`) inlines a copy of the engine and renders four Three.js flowers from one shared procedural petal generator, parameterized differently per domain (petal shape/count/color, bloom tightness) rather than four separate modeling pipelines. Growth stage drives scale and bloom-openness; wilting drives color desaturation and droop; soil moisture drives ambient lighting.

`demo.js` is a Node-runnable console demo of the same engine (`node demo.js`) — useful for verifying model behavior without touching any rendering code.

## Files

```
garden.html                       self-contained visualization (open this)
demo.js                           console demo of the growth engine (node demo.js)
lib/growthEngine.js                pure growth-model logic (canonical source; garden.html has an inlined copy)
lib/syntheticHistory.js            mock data generator
schema/synthetic-signals.schema.json   the daily input data contract
```

## Status

Prototype / portfolio piece. Data is entirely synthetic — no real Apple Health / GitHub / Notion integration yet. Four domains modeled (Sleep, Fitness, Study, Career); the original concept sketched out more (Relationship, Finance, Mindfulness).
