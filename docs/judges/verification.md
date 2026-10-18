# Repository preparation checks · 18 October 2026

[Judges' guide](README.md) · [Technical evidence](technical-evidence.md) · [Final package](../../submission/README.md)

This record describes checks performed while preparing the repository for review. It distinguishes delivery checks, saved-model checks and limited runtime checks. It is not a claim that every prototype function or policy effect has been validated.

## Version and scope

- Source baseline: [`4e15852757aa8ea5b109d61a3d7415f78c9e470f`](https://github.com/Senpagavv/transitlab-hk/commit/4e15852757aa8ea5b109d61a3d7415f78c9e470f).
- Final app: the original `Final.zip`, expanded unchanged into `submission/final-2026-10-18/`.
- Archive SHA-256: `6c01b7a5111f97ff9a803ed2fb2e1573c10adc8b56fc3da5e89b9bf433ed6f2a`.
- Presentation changes: English/Chinese entry and guides, historical labels, package provenance and a documentation-check scope update. The prior homepage is preserved as text. Existing data and numerical/game source files outside the preserved copy are not rewritten.

## Checks performed

| Check | Observed result | What it establishes |
|---|---|---|
| `python submission/verify.py` | Archive hash and all **127 files**, **18,449,617 bytes**, passed | Expanded source corresponds to the uploaded package; not predictive validity. |
| `python pipeline/check_docs.py` | **7 documents, 65 checks passed** | Tracked headline figures and retired-value checks agree with saved audits. Historical fleet figures are checked in historical documents, not forced into the new homepage. |
| `python -m pytest -q -p no:cacheprovider` | **89 passed**; one upstream Starlette deprecation warning | Existing root model/backend/game regression suite passed. This is not a complete test of every added deployment-package interaction. |
| `python pipeline/audit.py` | **118 passed, 2 failed**, the same recorded baseline categories | No newly introduced audit category. Road-count fit and bus preload remain unresolved; the command exits non-zero and is not presented as an all-pass result. |
| Final package local launch | FastAPI/Uvicorn started with the AI key and SMTP disabled for the check | The preserved app starts in an existing compatible Python environment without external AI/mail calls. |
| Local HTTP checks | **15 page/API/data requests** and **29 referenced script/style/image assets** succeeded | The five-mode entry, five game pages, editor, backups, baseline JSON and status endpoints are served. It does not verify all JavaScript behaviour. |
| Public review links | Six main/direct/backup entries returned HTTP 200 | The documented public destinations were reachable at preparation time. Availability can change. |
| Browser observation | Live mode 1 opened anonymously; its introduction, board, stop controls, start-state and language controls were visible | The direct first-level entry is usable without creating an account. A complete scored playthrough was not part of this check. |
| Source/configuration review | Blank credential templates; no live account database added; local runtime state ignored | This change publishes the source package rather than the server's private configuration or user records. |
| Document navigation | Local paths and declared heading anchors in the new review documents checked | Reviewers can follow the repository reading route without obsolete local-machine paths. |

The saved foundation's **112 tracked raw inputs, 34 model files and 78 web/audit files** were also compared with the baseline GitHub tree during the preceding inventory; all corresponding Git blob hashes matched. The existing data Release's **542 entries** matched the local zoning/cache file sizes and CRC32 values. This did not include a full archive decompression test.

## Checks not claimed

- No fresh run of the entire source-data pipeline, no government API re-download, and no new model calibration.
- No new real DeepSeek generation, SMTP delivery, account registration, score submission or full mobile usability certification during repository preparation.
- No clean-machine dependency installation or Docker image build in this environment. The local service check reused an existing compatible environment.
- No measured educational learning gain, real-world vehicle reduction or realised emissions saving inferred from the game output.

The game/source package retains its own earlier check files and method notes, including failed approaches. Their original context and dates remain part of the evidence; they are not re-labelled as fresh checks.

## 中文说明

这次整理核对了最终包原字节、文档数字、已有 89 项回归测试、保存底座审计、最终包本地启动、15 个页面/接口/数据请求、29 个引用资源，以及公开试玩入口。

数据审计仍有道路计数与巴士预载两类历史未达标项，不能写成全部通过或模型准确率。网页返回 200、AI 已配置或存在源码，也不等于完成了实际 AI 调用、邮件、注册、排行榜和全部交互的验收。本地启动复用了现有环境，没有宣称已在一台全新电脑安装或构建 Docker。
