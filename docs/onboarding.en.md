# Getting Started (for people)

> For teammates opening this project for the first time. After reading you should know what the project is, what to install, where to look for your role, and how to change things without breaking the base data.
> If you work with an AI assistant (Claude Code, Codex, Cursor…), have it read [`AGENTS.md`](../AGENTS.md) in the root first — the same rules, written for AI (in Chinese; AI assistants read it fine).
> Chinese version of this page: [`onboarding.md`](onboarding.md). New to GitHub? Start with [`team-quickstart.en.md`](team-quickstart.en.md).

## 0. What this project is (one minute)

A **Hong Kong transport + land-use model**. From government open data it links people, jobs, roads and public transport across 455 traffic zones, and works out the morning peak: who goes from where to where, by which mode, on which road or line.
On top of it we are building a **"draw a new line" planning game**: draw a new rail line or road on a real map; the model estimates ridership, congestion, how population shifts, and whether it is worth building.

- It is a **four-step model**: ① trip generation (how many trips each zone makes) → ② trip distribution (where they go) → ③ mode choice (car or public transport) → ④ assignment (which road, which line).
- Every step is **audited** against official figures (population census, Travel Characteristics Survey, Annual Traffic Census, MTR loads reported to LegCo); mismatches are reported.
- Current accuracy and known limitations: top of [`handoff.md`](handoff.md) (Chinese).

## 1. First time (everyone)

### 1.1 Software
| Software | What for | How |
|---|---|---|
| Git | Download the project, commit changes | <https://git-scm.com>, default options |
| GitHub CLI `gh` (recommended) or GitHub Desktop | Sign in to GitHub, clone, open Pull Requests | Windows: `winget install GitHub.cli`; or <https://desktop.github.com> |
| uv | Installs Python and the project's libraries | `winget install astral-sh.uv`, or see README "新电脑第一次配置" |
| Node.js 20+ | Runs the website front end | <https://nodejs.org> (LTS) |
| VS Code (recommended) | Read code and documents | <https://code.visualstudio.com> |

> **Windows user name with non-English characters**: set the ASCII-path environment variables described in README ("如果 Windows 用户名是中文") first, or some geospatial libraries fail.

### 1.2 Getting the project
1. Accept the invitation: GitHub emails "invited you to collaborate on transitlab-hk" → **Accept invitation** (the repository is private).
2. Sign in: `gh auth login` → GitHub.com → HTTPS → Login with a web browser, then enter the one-time code in the browser.
3. Clone: `gh repo clone Senpagavv/transitlab-hk` (about 450 MB: code, documents, model results, and all raw data except the statutory plans).
4. Environment: in the project root `uv sync`; then `cd frontend` → `npm install`.
5. Self-check: `uv run python pipeline/00_check_env.py`; all `[OK]` is fine (Java is only needed for step 18, the public-transport travel-time matrix).

### 1.3 Attachment (only for two steps)
The repository's **Releases** page has one zip:
- `data/raw/zoning/`: Town Planning Board statutory plans (zones of 153 plans + 152 notes PDFs, ~510 MB) — only needed to rerun `pipeline/37_statutory_zoning.py`;
- `data/cache/luhk2024/`: download cache of the Planning Department land-utilisation grid — only needed to rerun `pipeline/36_land_utilization.py`, and **with it you do not have to query the government server** (frequent requests get the IP blocked).

Unzip it **in the project root** (paths inside already start with `data/...`). Command line: `gh release download base-2026-09-26 --repo Senpagavv/transitlab-hk --pattern "*.zip"`.

## 2. Where to look, by role

### 2.1 Viewing results, giving demos
- Website: double-click `scripts\start-dev.cmd` (or the two commands under README "每天启动"), then open <http://localhost:5173>.
- Mini-games (bridge / metro line — frozen, kept as examples): double-click `game-demo/index.html` or `game-demo/metro.html`; no server needed.
- Result files: `data/model/` (tables and matrices the model computed), `data/web/` (website data and each step's `*-audit.json` check report).
- Where the data comes from: [`data-sources.md`](data-sources.md) (43 sources; size, fields, which step uses them — Chinese).
- Demo script: [`demo-runbook.md`](demo-runbook.md) (Chinese).

### 2.2 Front end
- Code: `frontend/` (React + MapLibre + deck.gl); back end: `backend/` (FastAPI).
- Development: two terminals — back end `uv run uvicorn backend.main:app --reload --port 8000`, front end `cd frontend; npm run dev`.
- Before committing: `cd frontend; npm run build` (type check + bundle) and `npm run lint`.
- Screenshot self-checks: `frontend/scripts/check-*.mjs` (headless Microsoft Edge).

### 2.3 Tuning the model and data
**Read first**: [`for-codex/pipeline-manifest.md`](for-codex/pipeline-manifest.md) (inputs, outputs, run time of every step) and section 9 of [`handoff.md`](handoff.md) (run order).
- Every `pipeline/NN_*.py` starts with a docstring: what it reads, how it computes, why, and where the data comes from.
- What data a fit used, how many rounds, how large the error: see the matching `data/web/*-audit.json` (the `report` field is a Chinese explanation).
- **Run order ≠ file numbering.** Full rebuild order and "what to rerun after changing step X" are in handoff section 9.
- **After changing demand or the road network you must finish with**: `… → 26 → feedback_loop (congestion feedback until stable) → 39 → diagnose_corridors → audit`.
- Rough run times: mode choice (23) 8–11 min; congestion feedback ~13 min per round (usually stable after 1); transit assignment (39) ~4 min; transit travel-time matrix (18) ~20 min.
- **Always run three checks after a change**: `uv run python pipeline/audit.py`, `uv run python pipeline/check_docs.py`, `uv run pytest`.
  The audit is at 118/120: the remaining 2 are known limitations (station-level fit, buses at 0.84), explained at the top of handoff; **no new failures are allowed**.

### 2.4 Drawing new lines, scenarios
- Quick version: `game-demo/metro.html` (computes in the browser in ~10 s, only the change against today); the algorithm is described at the top of `game-demo/sim.js`.
- Full version (what reruns when a new line enters the full model, how many rounds, which numbers to read): **document in preparation** (`docs/`, "how a new line runs").

## 3. Working together on GitHub

```
main (only reviewed work)
 ├─ your branch  →  edit, commit  →  push  →  open a Pull Request  →  approved  →  merged into main
```
1. Before new work: `git switch main` → `git pull` → `git switch -c yourname/what` (e.g. `amy/zone-panel`).
2. When done: `git add -A` → `git commit -m "one line saying what changed"` → `git push -u origin yourname/what`.
3. Pull Request: `gh pr create` (or **Compare & pull request** on the website) and tick the template's checklist.
4. Pull Requests touching `data/` or `pipeline/` should be approved by the project lead (listed in `.github/CODEOWNERS`).
5. After merging: `git switch main` → `git pull`.

## 4. Rules (protecting the base)

1. **`data/raw/` holds raw downloads only and is never edited by hand.** To change data, change the download script, re-download, and explain why in the Pull Request.
2. **`data/model/` and `data/web/` are produced only by `pipeline/` scripts** — never edit them by hand.
3. **Experiments must not overwrite official results**: write output to your own folder (e.g. `data/cache/yourname/`, not uploaded) or work on a new branch.
4. Local read-only snapshots: before changing, `uv run python scripts/snapshot_base_data.py`; afterwards `--check` shows what changed.
5. **Never commit** `.env` (keys), `data/cache/`, `data/snapshots/`, or any file over 50 MB.
6. **Do not hammer government APIs** (CSDI, DATA.GOV.HK, …) — our IP was blocked once; use caches.
7. If you change a number, update the documents that quote it (`check_docs.py` checks this).
8. **Never force-push.**

## 5. FAQ
- **`uv sync` is slow or fails on a path**: probably a non-English Windows user name, see 1.1.
- **Geospatial library fails reading `.gdb.zip`**: set `CPL_TMPDIR` to a folder with an English-only path.
- **Blank map on the website**: the base map comes from the Lands Department and needs internet; try another network if blocked.
- **A new FAIL in the audit**: read the `report` and `flags` of the matching `*-audit.json` in `data/web/`, then check section 6 of handoff ("pitfalls") for the same case.
