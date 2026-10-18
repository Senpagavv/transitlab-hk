# Technical evidence and reproduction

[Homepage](../../README.md) · [Judges' walkthrough](README.md) · [中文](technical-evidence.zh-CN.md) · [Final package](../../submission/README.md)

This page explains how the current prototype is connected to its data foundation. Historical fleet-sizing results are outside the current product's impact claims. Source and model provenance is distinct from whether the final user interface has passed every interaction test.

## From public inputs to the game

| Layer | What happens | Inspectable evidence |
|---|---|---|
| **1. Source inputs** | Census, building stock, schools, projections, transport surveys, roads, GTFS and traffic observations provide different pieces of the foundation. Years and spatial units differ. | [Source catalogue](../data-sources.md), [raw inputs](../../data/raw/), [data Release](https://github.com/Senpagavv/transitlab-hk/releases/tag/base-2026-09-26) |
| **2. Spatial foundation** | Census geography, buildings and attractions are joined; 211 census areas are split into 455 internal model zones. The model also has 15 external/boundary endpoints. 2026 estimates use the available source vintages rather than a new complete observation of every location. | `pipeline/08–16`, especially [zone splitting](../../pipeline/14_split_zones.py), [land use](../../pipeline/16_landuse_2026.py), [zone audit](../../data/web/zones-split-audit.json) |
| **3. Offline transport model** | Trip generation → distribution → mode choice → AM-peak road/transit assignment. Congestion is fed back into mode choice. | [Methods in English](../methods-catalogue.en.md), [pipeline manifest](../for-codex/pipeline-manifest.md), [saved model results](../../data/model/) |
| **4. Validation and saved outputs** | Totals, joins, geography and comparisons with observations are checked; unresolved mismatches remain visible. | [Audit code](../../pipeline/audit.py), [`data/web/`](../../data/web/), [registry](../../model/registry/data_tiers.toml) |
| **5. Game baseline** | The foundation is aggregated into a 400 m, 160 × 120 grid, with internal-zone OD and time-period approximations. This is a game representation, not the full engineering network. | [Grid builder](../../game-feeder/tools/hk-grid/build_hk_grid.py), [field-level method notes](../../game-feeder/tools/hk-grid/README.md), [final `hk/` data](../../submission/final-2026-10-18/game-feeder/v7-deploy/hk/) |
| **6. Interactive calculation** | Browser rules respond to player actions using the prepared baseline and a simplified numerical model. The offline four-stage pipeline is not executed at each click. | [Final sandbox engine](../../submission/final-2026-10-18/game-feeder/v7-deploy/mode5-sandbox/engine.js), [worker](../../submission/final-2026-10-18/game-feeder/v7-deploy/mode5-sandbox/worker.js), [engine notes](../../submission/final-2026-10-18/game-feeder/v7-deploy/mode5-sandbox/README.md) |
| **7. GenAI assistance** | A sentence becomes a validated scenario request; program tools build a level. Optional debriefs are based on computed results and undergo number checks. | [Final AI backend](../../submission/final-2026-10-18/backend/feeder_ai.py), [client and example fallback](../../submission/final-2026-10-18/game-feeder/v7-deploy/ai/client.js) |

The detailed historical method notes retain their original dates and some development paths. The linked current script is authoritative for where outputs are now written; do not copy an old desktop path as a launch command.

### The two computational loops

The **offline** loop is `27b → 23 → 24 → 27`, reconciling congested car times, mode choice and road assignment; transit assignment follows in step 39. Its input/output methods are documented in the [methods catalogue](../methods-catalogue.en.md).

The **game** has its own smaller rules and stopping criteria. Its sandbox starts from saved OD, travel times and road loads, computes changes under the player's plan and iterates simplified feedback. It preserves a no-change baseline by construction; that is an internal consistency check, not proof of predictive validity. [Engine notes](../../submission/final-2026-10-18/game-feeder/v7-deploy/mode5-sandbox/README.md) explain the solver, convergence and missing effects.

## Source reliability is field-specific

The project [registry](../../model/registry/data_tiers.toml) and [generated guide](../data-tiers.md) distinguish A/B/C/D. Source authority and whether a value is observed, projected or assumed must both be stated.

| Kind | How to interpret it |
|---|---|
| **A — attributed source input** | An identifiable source such as an official survey, count or published projection. An official projection remains a projection; it is not a measured 2026 count at every point. |
| **B — calibrated/model-derived** | A model result or deterministic aggregation with a documented method, not a new direct observation. |
| **C — inference/approximation** | A defensible proxy, geometric aggregation or time-period approximation with limits. |
| **D — illustrative assumption** | A gameplay or scenario assumption; not evidence that the represented condition actually occurred. |

For the game baseline, **AM OD is model-derived (B)**; 400 m road geometry and some displayed loads are **C**. PM/day OD are **C**, while some non-AM rail-load scaling is **D**. Holiday demand is **D**. These grades cannot be replaced by one blanket “all real data” label. Teaching maps also use simplified/illustrative rules and quantities.

The game OD represents **455 internal zones**. The offline model's **15 external endpoints are not all included** in those game pairs. Aggregation can merge parallel roads or grade-separated crossings and loses engineering turn/elevation detail. Field sources and exclusions appear in the [grid notes](../../game-feeder/tools/hk-grid/README.md) and [checks](../../submission/final-2026-10-18/game-feeder/v7-deploy/hk/checks.json).

## Validation and known limits

### Offline baseline

- The current saved baseline's audit reports **118 checks passed and 2 failed**. The two unresolved categories concern road-count fit and bus preload; they are retained in [`docs/handoff.md`](../handoff.md) and the underlying audits. This is **not 98.3% model accuracy**.
- [Road-assignment audit](../../data/web/assignment-audit.json): corridor GEH<5 is approximately **29.4%**, below the project's **60%** target. Aggregate total agreement does not establish local accuracy.
- [Bus-preload audit](../../data/web/bus-preload-audit.json): model/observed franchise-bus total is approximately **0.84**. The audit documents route/coverage limits.
- Numerical and spatial checks do not establish that an educational intervention improves learning or causes real-world emissions reductions. Those require separate user/outcome evaluation.

### Final prototype

The final package contains browser engines, a FastAPI backend, optional DeepSeek and SMTP configuration, account/leaderboard code and separate presentation backups. The preserved source is inspectable; the [verification record](verification.md) states what was actually checked during repository preparation.

Limitations include coarse geometry, simplified behavioural responses and capacity/feedback assumptions. Some time periods and teaching quantities are inferential or illustrative. “Run to stable” describes a numerical stopping condition, not a forecast horizon or an empirical validation certificate.

The GenAI backend uses allowed fields, bounds, retries and numeric debrief checks. These checks do not eliminate ambiguous intent, hallucinated interpretation or poor level quality. A prepared example or scripted strategy replay must not be represented as a successful live model call.

## Data delivery and reproduction

Choose the level of inspection needed; playing the prototype does not require rebuilding the research foundation.

### A. Run the prepared final game

Follow [`submission/README.md`](../../submission/README.md). The final package includes its game-ready Hong Kong JSON. Python plus the small backend requirements are sufficient; Java, the full GIS environment and raw-data downloads are not needed for this route. Without an AI key it uses example fallback; email behaviour depends on SMTP configuration.

### B. Inspect saved results and verify delivery

The preparation review compared **112 tracked raw inputs, 34 model files and 78 web/audit files** from the local foundation with the pre-organisation GitHub commit [`4e15852`](https://github.com/Senpagavv/transitlab-hk/tree/4e15852757aa8ea5b109d61a3d7415f78c9e470f); all corresponding Git blob hashes matched. The final package's 10 `hk/` data/check files matched the development baseline as well.

Run from the repository root:

```sh
python submission/verify.py
```

This verifies the preserved archive and each expanded package file against [`manifest.json`](../../submission/manifest.json). It tests delivery integrity, not traffic-model accuracy or every runtime feature.

### C. Rebuild the offline foundation

1. Use Python 3.12 and the root [`pyproject.toml`](../../pyproject.toml) / [`uv.lock`](../../uv.lock), then run `uv sync --frozen`. R5 transit skims additionally need Java 21; [environment checks](../../pipeline/00_check_env.py) and [onboarding](../onboarding.en.md) describe setup.
2. Download the existing [data Release](https://github.com/Senpagavv/transitlab-hk/releases/tag/base-2026-09-26) if rebuilding the land-use/zoning steps. Its ZIP contains 540 zoning files and 2 land-use-cache files. Extract at the repository root; paths begin with `data/`.
3. Read the [pipeline manifest](../for-codex/pipeline-manifest.md) and [full rebuild order](../handoff.md#9-文件地图). **Script numbers are not execution order.** For example, road connectors depend on generated building trip ends; the documented workflow runs some steps more than once.
4. The final game does not require rerunning the retired fleet experiment. Preserve necessary common utilities; do not delete a numbered range blindly.
5. For a changed demand/network baseline, complete the documented congestion feedback, transit assignment, diagnostics and audit before re-exporting the game grid. Re-export with `python game-feeder/tools/hk-grid/build_hk_grid.py` only when deliberately preparing new model data; it writes outputs.

The numbered pipeline writes data products and some steps access government services. It is not a one-command, network-free demonstration and was **not rerun during this repository presentation change**.

### What is intentionally outside Git?

| Content | Delivery decision |
|---|---|
| Statutory plans + LUHK cache | Already in the existing 399 MB [Release attachment](https://github.com/Senpagavv/transitlab-hk/releases/tag/base-2026-09-26). |
| Historical raw traffic XML, approximately 1.26 GB locally | Optional source-level reproduction material, currently not bundled here. Saved hourly observations and downstream results are tracked. Re-fetching the archive may not reproduce the exact sample set. |
| Tile caches, intermediate routing databases, `node_modules`, Python environments | Regenerable/downloadable working environment, not required for the prepared game. |
| Repeated historical snapshots and old trial outputs | Local backup/history; selected relevant methods and audits are retained. |
| `.env`, server keys, SMTP credentials and live account databases | Not public source; use blank templates and local/server configuration. |

## Attribution and interpretation

The [source catalogue](../data-sources.md), [reuse/reference record](../reuse-and-references.md) and [grid metadata](../../submission/final-2026-10-18/game-feeder/v7-deploy/hk/) identify providers and transformation caveats. The UI retains relevant mapping attribution. Third-party source terms, including OpenStreetMap/ODbL where applicable, continue to apply. This presentation change does not relicense all underlying materials.

For competition assessment, distinguish **implemented code**, **verified behaviour**, **model-based scenario results**, and **future impact/evaluation plans**. The official criteria explicitly ask what works versus what is simulated: [Judging Criteria](https://www.hack4sdg.com/judging-criteria/).
