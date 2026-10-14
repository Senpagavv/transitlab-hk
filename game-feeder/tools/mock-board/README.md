# 任务56交回说明

2026-10-15。桌面交付目录：`%USERPROFILE%\Desktop\TransitLab五模式-Codex\任务56\`。

已按“关卡包 → 排行榜及本机成绩 → 核分 → 假后台和CDP鼠标 → 接入说明”的顺序完成前端初稿及本机验收。F:\transitlab-hk全程只读，未做git操作，未请求组员线上网站。v7和v3完整复制到指定目录；142个原有文件的SHA-256与源项目一致，模式页、规则、引擎、注册表、旧v3均未修改。

## 本次新增

- `game-feeder/v7/shared/levelpack.js`：会话关卡包存取、SHA-256校验、导出导入、关闭的上传接口、等待加载后启动模式页并填开场名称/故事。
- `game-feeder/v7/shared/board.js`、`board.css`：结算按钮、前50名、我的名次、配置登录链接、主动上传、本机每关前10名、三语言。
- `game-feeder/tools/verify-score.js`：任务书第3节要求的Node核分脚本，重放模式1/2/3/4 TOD。第三模式保留两阶段；TOD保留卖地年份。非合法操作或差值≥0.5拒绝。
- `game-feeder/tools/mock-board/`：内存假后台、验收页、临时HTTP响应接入、Node测试、CDP鼠标脚本、原分和篡改分夹具。
- `game-feeder/v7/INTEGRATION.md`：仅“排行榜”一节，含关卡包、接口和各模式准确接入片段，中英交接。
- `shots/`：12张真实浏览器截图、browser-check.json、scope-audit.json、Node和CLI输出。

## 验收结果

Node **9组通过、0失败**：存取/独立副本、导出导入一致、哈希篡改拒绝、四模式必需字段检查、关闭上传零请求、模式1/2/3/4引擎重放、两阶段最小快照、每关本机前10和存储失败回退、假后台Cookie/排名/拒收、CLI退出码。

第三模式大师方案原始引擎约3320.73，显示3321，核分通过；仅把报分3321改为3322，CLI退出1；差值等于0.5也拒绝。没有改变引擎数值来凑3321。

隔离的已安装Edge中用 **CDP Input.dispatchMouseEvent** 点击验收：自定义关卡3321分、真实模式1第4关183分完成两次上传，各自名次1；未登录提示、假登录、上传、排名、三种语言、教学关没有榜按钮；四模式 `#pack=id` 的实际开场卡名称与故事；真实关闭服务后刷新显示“本机”。页面JS异常0。既有模式1快进挂钩用于到达结算，按钮操作均是CDP鼠标。

假后台曾通过 `/__mock/m1`、`/__mock/mode` 在HTTP响应中临时插入接入脚本；这不是对磁盘模式页的改动。截图09的四个文件验证包启动，截图08验证服务已关闭后的本机回退。浏览器扩展入口无法连接后，改用任务明确指定的CDP方式；沙箱隔离造成的本机连接问题通过让服务与隔离浏览器处于同一本机环境解决。

## Claude接手

照 `v7/INTEGRATION.md` 的表和代码，给mode1-bus、mode2-metro、mode3-roads、mode4-tod增加CSS/共享脚本，把UI加载改为等待包，给结算函数添加 `feeder:result`。完整计划用 `TLBoard.snapshot(n, gameOrPlan)` 取，第三模式不能只发最终线网，第四模式不能漏卖地年份。正式登录URL和响应包装交给负责上线的组员适配。

原快照只有模式1第4关l4注册为挑战；模式2/3/4各只有第1关，没有擅自新造第四关。模块按challenge标记识别，组员以后登记的挑战关会自动生效。第五模式沙盘没有同样的关卡文件/总分契约，旧mode4-bus也不等于当前TOD模式4；不能混榜，需要负责人先定义契约。

关卡库仍未开放，`TL_FEATURES.levelUpload=false`；开关关闭时不发库上传请求。普通自定义关卡暂留sessionStorage，导出文件后才方便下次重新导入。正式后台核自定义分数须使用它自己保存的可信关卡定义；假后台只在服务端登记本机验收夹具，没有声称完成生产后台对接。

`build.py`与旧单文件均未改。Claude完成正式模式页接入后，再按原有流程审、真鼠标复验、重新打包和提交。本交付没有提交或部署。

## 重跑

在任务56目录运行：

```powershell
node --test game-feeder/tools/mock-board/test.js
node game-feeder/tools/verify-score.js feeder/m3/m3-1 game-feeder/tools/mock-board/fixtures/master.json
node game-feeder/tools/verify-score.js feeder/m3/m3-1 game-feeder/tools/mock-board/fixtures/master-tampered.json
node game-feeder/tools/mock-board/server.js 8866
```

打开 `http://127.0.0.1:8866/`。假登录不含真实账户或密码，内存成绩重启清空。自动鼠标验收需已有Playwright及Edge：设置 `PLAYWRIGHT_MODULE` 为已有包路径后运行 `node game-feeder/tools/mock-board/browser-test.js`，脚本最后关闭假后台；本次验收结束时服务已停止。

主脚本与Node测试无新增依赖、无外网调用。CDP脚本会阻止非本机请求，假后台CSP阻止原页面的外部字体和资源。

## English handoff

Task 56 was implemented in the requested Desktop copy. All 142 original v7/v3 files match the source hashes; no mode page, engine, registry, git operation or production network request was changed/performed. New modules provide session packs, a localized board with local fallback, legal engine replay, and a localhost mock.

Nine Node test groups passed. Actual CDP mouse tests uploaded a custom score of 3321 and a real mode-1 challenge score of 183, displayed rank 1 for each, checked signed-out/signed-in states, teaching exclusion, all four pack opening cards, three languages and fallback after shutting down the service. Twelve screenshots and machine-readable results are included.

Claude should apply the explicit page/event snippets in v7/INTEGRATION.md, review, rerun, build the standalone pages and commit. Production authentication/backend integration and the unopened level library remain with the deployment teammate. Only mode 1 currently has its fourth challenge registered. Sandbox mode 5 and legacy mode4-bus lack the current tl-level/1 leaderboard contract and must not be mapped to TOD. The localhost mock has been stopped after acceptance.
