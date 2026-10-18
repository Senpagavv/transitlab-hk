# Judges' guide

[Project homepage](../../README.md) · [中文](README.zh-CN.md) · [Technical evidence](technical-evidence.md) · [Final source and local launch](../../submission/README.md)

**TransitLab HK is an interactive transport-learning prototype: four focused games lead into a Hong Kong sandbox, with GenAI helping users express scenarios and review computed results.** The current submission is the package dated **18 October 2026**, preserved in [`submission/final-2026-10-18/`](../../submission/final-2026-10-18/).

## Suggested review route

### 1. Try a small decision

Open [mode 1, Long Ping](http://43.128.15.246/feeder/mode1-bus/index.html#map=l1). Enter through the short introduction and select **EN** in the top language bar.

- Select stop **A**, then a **+** on the board; repeat for **B** and **C**. The start button becomes available once all three are placed.
- Press **Start**. Watch residents split between stops, buses carry limited loads, and some people drive instead. Speed controls and **F** help shorten observation.
- Compare a second placement. The useful question is why a change helps one estate while making another queue worse, rather than whether one stop is universally best.

The **AI demo** button in the teaching levels replays prepared strategies. It is a teaching aid, **not evidence of a new live LLM response**.

For an immediate backup, use the separate [interactive mode 1 demo](http://43.128.15.246/feeder/demo-static/mode1.html) or [station-development demo](http://43.128.15.246/feeder/demo-static/mode4.html). These simplify the full game for presentation; they require no registration and do not submit leaderboard scores.

### 2. See the progression

Return to [the five-mode map](http://43.128.15.246/feeder/):

| Mode | New relationship introduced |
|---|---|
| 01 · Stations & walking | Access distance, demand splitting, queues and capacity |
| 02 · The metro | Line design, service and budget |
| 03 · Roads that jam | Public transport, changing car use and congestion feedback |
| 04 · Station-side development | Accessibility and land development |
| 05 · Hong Kong sandbox | Player-defined scenarios on a prepared city baseline |

### 3. Explore one sandbox change

Open [the sandbox directly](http://43.128.15.246/feeder/mode5-sandbox/). Select English and follow the on-screen tool labels.

1. Start from the baseline and note the selected time period and its data grade.
2. Make **one** change: adjust a district's population, or draw a line and place stations using the appropriate tools.
3. Run a round or use **Run to stable**. Wait for completion; a large city computation is not instantaneous.
4. Inspect the before/after results and operation history. A result is conditional on this model and scenario; it is not an observed real-world outcome.

The final package has account and leaderboard functionality. A full email-verification flow depends on server SMTP configuration; a demo configuration can auto-enable an account. No real user database or server credentials are included in the repository.

## What GenAI does

The GenAI component uses server-side **DeepSeek** (configured model name, default `deepseek-chat`). It has two defined jobs:

1. **Scenario/level requests:** turn natural language into a structured request using allowed areas, modes and bounded changes. Program validation checks the request; procedural tools build and check the level. The model is not given unrestricted control of the simulator.
2. **Debrief:** explain supplied game results. The backend checks numbers in the text against the submitted summary. This reduces unsupported numeric claims; it does not guarantee every explanation or causal statement is correct.

Useful source entry points in the **final** package:

- [`backend/feeder_ai.py`](../../submission/final-2026-10-18/backend/feeder_ai.py): request validation, DeepSeek call, retry and numeric checks.
- [`ai/client.js`](../../submission/final-2026-10-18/game-feeder/v7-deploy/ai/client.js): frontend request flow, build/retry feedback and predefined examples.
- [`shared/levelgen/`](../../submission/final-2026-10-18/game-feeder/v7-deploy/shared/levelgen/): procedural level construction and checks.
- [`mode5-sandbox/ai-level.js`](../../submission/final-2026-10-18/game-feeder/v7-deploy/mode5-sandbox/ai-level.js): sandbox integration.

To review live GenAI, enter a supported transport scenario in the AI panel and inspect the generated request and resulting level. A useful sequence is one valid request followed by an ambiguous or out-of-range request, observing how the system handles it. These calls require the server's configured AI service and can fail; an endpoint reporting `ready` only indicates configuration, not that a generation has succeeded.

**Predefined examples and scripted teaching demonstrations must be identified separately from live generation.** The offline four-stage transport model and browser numerical solver are also distinct from GenAI.

## Where the data and numbers come from

Read [the technical evidence page](technical-evidence.md) for the short, linked chain:

**Public sources → cleaned spatial foundation → offline four-stage model → saved results/audits → 400 m game grid → browser simulation → optional AI debrief.**

It identifies input years and estimates, the 455-zone game coverage, source files, transformation scripts, validation checks and known limitations. The purpose is to make an output traceable without requiring every reviewer to rerun the model.

## Evidence against the official criteria

The [official main-prize criteria](https://www.hack4sdg.com/judging-criteria/) give the following five areas equal weight. This is an evidence map, not a claim that a score has been awarded.

| Criterion | Evidence to inspect | Boundary of the claim |
|---|---|---|
| **Problem framing — 20%** | Progressive decisions in modes 1–4 and their connection to Hong Kong mobility; team pitch for stakeholder research | The repository demonstrates the proposed learning approach. It does not establish the scale of unmet demand or educational benefit by itself. |
| **Prototype/demo — 20%** | [Live first level](http://43.128.15.246/feeder/mode1-bus/index.html#map=l1), [sandbox](http://43.128.15.246/feeder/mode5-sandbox/), final source, backup demos and local launch | Backup explanatory pages and simulations are labelled; source availability does not imply that every deployed interaction has been tested. |
| **Appropriate technical component — 20%** | Constrained GenAI request, program checks, numerical simulation, checked debrief and example fallback | GenAI assists expression/explanation; it does not invent observed transport data or replace the numerical engine. |
| **Feasibility/impact — 20%** | Browser delivery, [deployment templates](../../submission/final-2026-10-18/deploy/), reusable levels and editors | Simulated ridership is not measured real-world adoption. Learning gains and deployment costs require separate evaluation. |
| **Sustainability/ethics — 20%** | Source attribution, A/B/C/D labels, [known limits](technical-evidence.md#validation-and-known-limits), server-only keys and privacy-aware delivery | Plans for ongoing operation and user evaluation should be assessed as plans unless supporting evidence is supplied. |

The optional WorkBuddy award has a separate report and criteria. Other coding assistants' activity is not presented as WorkBuddy usage.

## Reproduce or inspect further

- **Play locally:** [final-package instructions](../../submission/README.md). No Java/GIS setup or raw-data download is needed for the prepared game.
- **Verify the delivered source:** run `python submission/verify.py` from the repository root; see the [manifest](../../submission/manifest.json).
- **Trace or rebuild data:** [reproduction options](technical-evidence.md#data-delivery-and-reproduction), including the existing data Release and optional local-only caches.
- **Inspect developer history:** [history index](../history/README.md). Earlier taxi-fleet and dispatch directions are retained there, outside the current review route.
