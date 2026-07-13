# Performance Results

**No performance benchmarking was performed this milestone.** Per the definition of done's own rule ("do not claim scale that was not tested"), this is stated plainly rather than fabricated.

## Why
The scope decision ("Reliability + core editing") prioritized the outbox worker and optimistic-concurrency editing correctness over UI-scale features (multi-select, layers, quantity summary) that would actually be the primary drivers of render/selection/summary latency at 500–5000 objects. Benchmarking selection latency, marquee latency, or summary calculation time is not meaningful when those features don't exist yet.

## What IS true, structurally, without a benchmark
- The drag interaction only writes to the DB once per drag (on `mouseup`), never per `mousemove` — this was a deliberate design constraint from the start (STEP 4's "pointer movement does not trigger repeated database writes"), not something requiring a benchmark to verify; it's true by construction (one `fetch` call in `commitShapeDrag`, called from exactly one `mouseup` listener per drag).
- The outbox worker claims and processes events in bounded batches (`batchSize`, default 20) rather than unbounded — a save/delete never blocks on an arbitrarily large backlog.

## Recommended follow-up
Once multi-select, layers, and the quantity summary exist, benchmark at 100/500/2,000/5,000 objects per the original spec's list (initial render, pan/zoom, selection latency, marquee latency, property-edit latency, layer-toggle latency, summary calculation time, save latency, API response size, React re-render count) before claiming any specific scale is supported.
