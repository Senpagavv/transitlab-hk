# Feeder bus game: deployment and integration

> For the teammate who runs the website, accounts and leaderboard. 中文：[`INTEGRATION.md`](INTEGRATION.md)
> In one line: this is a **static web game**. Copy it unchanged into a sub-folder of the website and it plays; connect login and the leaderboard with your own script, **without editing the game**.

## 1. Where the source is

Folder `game-feeder/v3/` in the private repository `Senpagavv/transitlab-hk`. The repository also holds a few hundred MB of transport data; to get only the games:

```bash
git clone --filter=blob:none --sparse https://github.com/Senpagavv/transitlab-hk.git
cd transitlab-hk
git sparse-checkout set game-feeder
```

| File | What it does |
|---|---|
| `index.html`, `style.css`, `logo-tide.svg` | Page, styles, logo |
| `data.js` | The three level boards (Fanling, Yuen Long South, Long Ping) and the territory-wide site points |
| `engine.js` | Game rules (who walks to which stop, buses, scoring). Runs in the browser and in Node |
| `ui.js` | Level screen, controls, result |
| `hub.js`, `cover-data.js` | Intro → territory map → pick a station to enter a level |
| `i18n.js` | All texts in Traditional Chinese / Simplified Chinese / English |
| `开始游戏.html` | Everything above bundled into one file (made by `python build.py`) |
| `verify_result.js` | **For the server**: checks that a score is genuine (section 4) |
| `test_engine.js`, `build.py` | Checks and bundling; do not upload |

## 2. Put it on the server unchanged

No back end and no Node on the server. Either way works; put it under a `/feeder/` sub-folder of the site (**do not replace the site's home page**):

- **A. One file (simplest)**: rename `开始游戏.html` to `index.html` and put it in `/feeder/`.
- **B. Source folder (easier to add your own script)**: upload `index.html`, `style.css`, `logo-tide.svg`, `data.js`, `engine.js`, `i18n.js`, `cover-data.js`, `ui.js`, `hub.js` to `/feeder/`.

On the same site, the game page shares the site's login cookie. Fonts load from Google Fonts; where that is blocked the page falls back to system fonts and still plays. Set up HTTPS before opening sign-up and login to the public.

## 3. Hooking in your features: events the game fires

Add one line with your own script before `</body>` in `index.html`, for example `<script src="/feeder-site.js"></script>`. The game fires these events on `window`:

| Event | When | `e.detail` |
|---|---|---|
| `tl:result` | **Once per finished round** | The result record, fields below |
| `tl:lang` | The player switches language in the game | `'zh-Hant'` / `'zh-Hans'` / `'en'` |
| `tl:entered` | A level is entered | none |

Fields of `tl:result`:

| Field | Example | Meaning |
|---|---|---|
| `game`, `version` | `'feeder'`, `'3.1'` | Which game, which version |
| `map` | `'fanling'` | Level: `fanling` / `yuenlong` / `longping` |
| `score` | `178` | People delivered to the MTR (the score) |
| `total` | `234` | People in the level (Fanling 234, Yuen Long South 192, Long Ping 192) |
| `tier`, `tiers` | `1`, `[174,180,185]` | 0 not cleared / 1 cleared / 2 high score / 3 tide master, and the three thresholds |
| `cars`, `missed` | `46`, `2` | People who drove instead, people who never left home |
| `seed`, `opening`, `moves` | `1781`, `[[2,2],[6,2],[2,6]]`, `[{time:90,id:2,cell:[2,5]}]` | The whole round, for the server to replay and check |
| `lang` | `'zh-Hant'` | Language at the time |

You can also call `I18N.set('en')` (switch language), `I18N.lang` (current language), `TL_GAME.map()` (current level), `TL_GAME.pause()`.

**Language**: the game reads its own `tl-lang` first; if the player never chose one in the game, it reads the site's `tlhk-lang` (same codes). Languages the site has and the game lacks (es, ru, ja, ko, id) show English. To sync a choice made in the game back to the site, listen to `tl:lang` and write `tlhk-lang` (example below).

**Stored in the browser**: `tl-best-<level>` (best score on this device), `tl-lang`, `tl-theme`. The game itself **sends nothing to any server**.

Example (`/api/feeder/scores` is a suggested new endpoint; it does not exist yet):

```js
// feeder-site.js: the site's own script, the game code stays untouched
addEventListener('tl:result', async e => {
  const me = await fetch('/api/auth/me', { credentials: 'same-origin' }).then(r => r.json()).catch(() => null);
  if (!me || !me.user) return;                       // not logged in: the score stays on this device
  fetch('/api/feeder/scores', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(e.detail)
  });
});
addEventListener('tl:lang', e => { try { localStorage.setItem('tlhk-lang', e.detail); } catch (_) {} });
```

## 4. Leaderboard integrity: check the score on the server before saving

The rules are deterministic: the same seed + the same three opening stops + the same moves always give the same score. So the server should not trust the `score` the browser reports; it replays the round:

```js
// Node back end: verify_result.js, data.js and engine.js in the same folder
const verify = require('./verify_result.js');
const check = verify(body);              // body = the tl:result record from the browser
if (!check.ok) return res.status(400).json(check);
// save check.score (computed by the server); check.map tells the level
```

For a back end that is not Node (Python, say), write the record to a file and run `node verify_result.js result.json`: exit code 0 = genuine, 1 = not (it also prints the JSON result). One check takes a few tens of milliseconds.

- Keep **one board per level**: the three levels have different totals and thresholds.
- Keep it separate from the rail-planning game's leaderboard.
- If the rules change later (`version` changes), store or label older scores separately.

## 5. Working on the code together

- **Game rules and numbers** (`engine.js`, `data.js`) are Benny's call; talk to him before changing them. The interface and your own site scripts you can change directly.
- Work on your own branch (`<name>/<what>`) and merge through a Pull Request; add an entry to the v3 section of `game-feeder/LOG.md` and to `CHANGELOG.md` at the repository root (time, what, why, how verified).
- After a change run `node v3/test_engine.js` (all 22 checks must pass), then `python v3/build.py` to rebuild `开始游戏.html`.
- **Please also push the website code that actually runs on the server (accounts, leaderboard, languages) to GitHub**, as a new folder in this repository or as its own repository, so the two can be integrated and rolled back later. Never commit `.env`, passwords, mail app passwords or database files.
