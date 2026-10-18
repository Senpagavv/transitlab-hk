# Final submission · 18 October 2026

[Project homepage](../README.md) · [Judges' guide](../docs/judges/README.md) · [中文导览](../docs/judges/README.zh-CN.md)

## Browse the final source

**[`final-2026-10-18/`](final-2026-10-18/)** is the exact, expanded content of the original [`Final.zip`](../Final.zip). It is a self-contained deployment package, distinct from the earlier root `backend/` and `game-feeder/v7/` development tree.

| Component | Source |
|---|---|
| Five-mode entry and game pages | [`game-feeder/v7-deploy/`](final-2026-10-18/game-feeder/v7-deploy/) |
| Hong Kong data and provenance/check files | [`hk/`](final-2026-10-18/game-feeder/v7-deploy/hk/) |
| Sandbox numerical engine | [`mode5-sandbox/`](final-2026-10-18/game-feeder/v7-deploy/mode5-sandbox/) |
| GenAI validation and service calls | [`backend/feeder_ai.py`](final-2026-10-18/backend/feeder_ai.py) |
| Web service, accounts and leaderboard routes | [`backend/main.py`](final-2026-10-18/backend/main.py) |
| Docker/Caddy deployment | [`deploy/`](final-2026-10-18/deploy/) |
| Separate no-account presentation demos | [`demo-static/`](final-2026-10-18/game-feeder/v7-deploy/demo-static/) |

The original archive came from commit [`4e15852`](https://github.com/Senpagavv/transitlab-hk/commit/4e15852757aa8ea5b109d61a3d7415f78c9e470f). The expanded 127 files total 18,449,617 bytes. The archive SHA-256 is:

```text
6c01b7a5111f97ff9a803ed2fb2e1573c10adc8b56fc3da5e89b9bf433ed6f2a
```

[`manifest.json`](manifest.json) records each original package file's SHA-256 and size. Added review documentation, the verifier and the manifest live outside the preserved package.

## Run locally

Use **Python 3.12**. Download/clone the repository first and open a terminal in its root. This route uses the prepared game data; it does not need Java, the root GIS environment, or raw-data reconstruction.

### Windows PowerShell

```powershell
cd submission/final-2026-10-18
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

If the Python launcher is unavailable, use your Python 3.12 executable instead of `py -3.12`.

### macOS / Linux

```sh
cd submission/final-2026-10-18
python3.12 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Then open:

- First level: <http://127.0.0.1:8000/feeder/mode1-bus/index.html#map=l1>
- Five-mode entry: <http://127.0.0.1:8000/feeder/>
- Sandbox: <http://127.0.0.1:8000/feeder/mode5-sandbox/>
- Presentation backup: <http://127.0.0.1:8000/feeder/demo-static/>

Stop the local service with **Ctrl+C**. It binds only to your computer.

### Optional services

Copy the package's `.env.example` to `.env` only when configuring services:

- **DeepSeek:** set your own server-side `DEEPSEEK_API_KEY`. Without a key, supported predefined examples provide a fallback; do not label them as live generation.
- **SMTP:** optional for email verification. The package's documented demo configuration can activate accounts without SMTP. This is different from a verified real-email flow.
- **Accounts and leaderboard:** the app creates local SQLite state under `data/app/`. This runtime data is excluded from Git. Keep `.env`, email authorisation codes and account databases private.

No example account or shared password is required for the review route. The repository's original package instructions are preserved in the final folder, but the steps above avoid old machine-specific paths and example ZIP filenames.

## Verify the package

From the **repository root**, with any modern Python 3:

```sh
python submission/verify.py
```

Expected result: the archive checksum and all 127 expanded files pass. The verifier reads files only; it does not run the game, contact services, install dependencies or rebuild data. Existing runtime files such as a locally created database are not part of the declared package.

For verification performed during repository preparation and known limits, see the [verification record](../docs/judges/verification.md).

## 中文：版本与启动

`final-2026-10-18/` 是根目录 `Final.zip` 的 **127 份原文件按原字节展开**，方便直接浏览；没有把它覆盖到旧的根目录后台。游戏、AI、账号与部署源码都在上表对应入口。

本地只玩最终包时，用 Python 3.12 按上方 Windows 或 macOS/Linux 命令启动，访问 `/feeder/`。无需安装完整模型的 Java/GIS 环境或下载大体积图则。第一关直达链接能跳过地图找关；独立备用演示不用注册。

不配置 AI 密钥时是预设示例回退；不配置 SMTP 时属于演示账号行为，不能当作已验证邮箱。密钥只放本地/服务器 `.env`；运行生成的账号数据不提交。

从仓库根运行 `python submission/verify.py` 可核对 ZIP 和展开文件。若要重算底层模型，另看[技术证据与复现](../docs/judges/technical-evidence.zh-CN.md)，不要把两套环境混为一谈。
