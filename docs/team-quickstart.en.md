# TransitLab HK · Joining the Team

> For teammates using GitHub for the first time. Going through it once takes about 30–60 minutes; after that you can see all the code, data and documents, and submit your own changes.
> Repository: **https://github.com/Senpagavv/transitlab-hk** (private — only invited teammates can open it)
> Questions: ask Benny in the group chat.

## What this project is (30 seconds)

A **Hong Kong transport + land-use model**. From government open data it links the population, jobs, roads and public transport of 455 traffic zones across Hong Kong, and works out the morning peak: who travels from where to where, by which mode, on which road or line.
On top of it we are building a **"draw a new line" planning game**: draw a new rail line or road on the map, and the model estimates ridership, congestion, how population shifts, and whether it is worth building.
The repository already contains all the code, model results, raw data, the check report of every step, and the documentation.

## Step 1 · Create a GitHub account and post your username in the group

1. No account yet: open <https://github.com> → **Sign up** with an email you use (skip if you already have one).
2. Find your username: after signing in, click your **avatar** (top right); the bold line at the top of the menu is your username (not your email).
3. **Post your username in the group chat.** Benny will send you an invitation.

## Step 2 · Accept the invitation

1. You will get an email from GitHub: *Senpagavv invited you to collaborate on transitlab-hk* → click **View invitation**.
   (No email? Open <https://github.com/Senpagavv/transitlab-hk/invitations> directly.)
2. Click the green **Accept invitation**.
3. The invitation is **valid for 7 days**; if it expires, ask in the group for a new one.

After accepting, <https://github.com/Senpagavv/transitlab-hk> shows every file and document in your browser. **If you only want to read, you can stop here.**

## Step 3 · Install software (only if you will download the project or change things)

| Software | What for | Who needs it |
|---|---|---|
| **GitHub Desktop** (recommended) | Download the project and submit changes with buttons, no command line | Everyone who will change things · <https://desktop.github.com> |
| VS Code | Read code and documents (`.md` files have a preview button, top right) | Recommended · <https://code.visualstudio.com> |
| uv (Python), Node.js 20+ | Run the model / the website | Model and front-end people; see `docs/onboarding.en.md` in the repository |

After installing GitHub Desktop, sign in with your GitHub account (it asks *Sign in to GitHub.com* the first time).

**If you will run the website or the model: after downloading the project (Step 4), set up everything else in one go** —
- **Windows**: double-click `scripts\setup-windows.cmd` in the project and wait for "装好了 / All set" (first time about 5–15 minutes; it installs uv, Node.js, Python 3.12 and every library).
- **Mac**: open Terminal, go to the project folder, run `bash scripts/setup-mac.sh`.
- Stuck? Post the project's `data\cache\setup-log.txt` in the group.

## Step 4 · Download the project to your computer

With GitHub Desktop:
1. Menu **File → Clone repository…**
2. Pick **Senpagavv/transitlab-hk** from the list (not there? you have not accepted the invitation yet — back to Step 2).
3. **Local path**: choose a folder with **only English letters and no spaces**, e.g. `D:\projects\transitlab-hk`.
4. Click **Clone** — about 450 MB, wait for it to finish.

(Command line users: `gh repo clone Senpagavv/transitlab-hk`)

## Step 5 · Read these first (in this order)

| File | What it covers | Language |
|---|---|---|
| `README.md` | Front page: overview, how to start the website | Chinese, English entry links at the top |
| `docs/onboarding.en.md` | **Getting-started guide** by role (view results / front end / model tuning / new lines): where to look, how to run things | **English** |
| `docs/handoff.md` (top part) | Where the project stands, accuracy, known limitations | Chinese |
| `docs/data-sources.md` | The 43 data sources: size, contents, which step uses them | Chinese |
| `AGENTS.md` | **Rules for AI assistants** — if you work with Claude / Codex / Cursor, have the AI read this first | Chinese (AI assistants read it without trouble) |

Documents that are only in Chinese: open them in the browser and use its translate function, or ask your AI assistant to translate / summarise them in English. Code comments and program docstrings are mostly in English.

## Step 6 · Making changes day to day (GitHub Desktop)

```
main (the shared, official version)
   └─ your own branch ── edit, commit ── push ── open a Pull Request ── Benny reviews ── merged into main
```

1. **Every time before you start**: click **Fetch origin** at the top; if there are updates, click **Pull origin**.
2. **Create your own branch**: **Current branch → New branch**, name it `yourname/what-you-do` (e.g. `amy/zone-panel`) → **Create branch**.
3. **Edit files** (in VS Code or any tool). GitHub Desktop lists the changed files on the left.
4. **Commit**: bottom left, write one line in *Summary* saying what you changed → **Commit to your-branch**.
5. **Push**: click **Publish branch** (first time) or **Push origin** at the top.
6. **Open a Pull Request**: click **Create Pull Request**; the browser opens — say what you changed and why → **Create pull request**, then tag Benny in the group.
7. After it is merged: switch **Current branch** back to `main` → **Pull origin**.

## Step 7 · A few rules (to protect data that took a long time to build)

1. **Do not change `main` directly**; always work on your own branch and open a Pull Request.
2. **Never edit `data/raw/` (raw downloads) by hand**; `data/model/` and `data/web/` (model results) are produced only by the programs — do not edit them by hand.
3. Experiments: do them on a new branch, or write the output to `data/cache/yourname/` (that folder is never uploaded).
4. **Do not upload**: `.env` (the file holding keys), or any file larger than 50 MB.
5. **Never use "Force push"** — it overwrites other people's history.
6. Broke something? **Don't panic**: every change on GitHub is recorded and can be undone. Just say so in the group.

## Appendix · An attachment only a few people need

If you need to rerun the "statutory plans" step (`pipeline/37`) or the "land utilisation" step (`pipeline/36`), download `transitlab-hk-extras-2026-09-26.zip` (399 MB) from the repository's **Releases** (right-hand sidebar) and **unzip it into the project's root folder**. Nobody else needs it.
