# 任务61：静态版打包与上线（发起人操作）

这份工具只在本机准备文件，不登录账号，不上传、不部署、不调用外部接口。真正的 Cloudflare 发布由发起人自己操作；发布前请 Claude 审查并用真鼠标验收。

## 1. 先生成网站

在项目根目录打开 PowerShell。推荐输出到项目外一个**新的空目录**：

```powershell
python game-feeder/tools/deploy/build_static.py "$env:USERPROFILE\Desktop\TransitLab-site"
```

也支持任务书的默认用法（默认输出 `F:\transitlab-hk\site`）：

```powershell
python game-feeder/tools/deploy/build_static.py
```

脚本不会覆盖已有文件夹内容。再次打包请换一个新的空目录；确认旧包不再需要后，由自己清理或改名。脚本输出 PASS、文件数、总大小、最大十个文件，并在 `site` 的**旁边**生成构建报告。禁止清单、疑似密钥、文件大小、文件数量、HTML 引用或未审计根地址检查不通过时会返回非零退出码。失败目录不能上传。

如果使用项目中的 `site/`，发起人应自己把 `/site/` 加进项目 `.gitignore`，同时忽略相邻的 `site-build-report.json`、`site-check-report.json`；也可始终输出到项目外。本任务未操作 Git、未更改原项目的 `.gitignore`。

网站内容如下，上传时不能只上传 `feeder`：

```text
site/
  index.html
  feeder/                 # 游戏、编辑器、浏览器 worker、全港静态数据
  _headers
  _redirects
  404.html
```

`/` 通过 `_redirects` 以 302 跳到 `/feeder/`，HTML 也提供后备跳转。以后后台地图可接管 `/`，游戏仍在 `/feeder/`。不使用全站 SPA 重写，未知网址会得到真正的 404。

## 2. 跑本机浏览器检查

使用项目**已有**的 Node、Playwright 和 Edge/Chromium。工具不自动下载安装依赖，也不打开登录页面：

```powershell
node game-feeder/tools/deploy/check_site.js "$env:USERPROFILE\Desktop\TransitLab-site" --playwright=F:\transitlab-hk\frontend\node_modules\playwright
```

实际项目不在 F 盘时，把 `--playwright=` 后改成已有 Playwright 包目录。若在项目根目录运行并且可直接找到 `frontend/node_modules/playwright`，可省略此参数。检查会自行启动并关闭本机静态服务器、启动无头浏览器、拦截外部及后台请求，报告默认写在网站文件夹旁边。最后必须显示 `PASS`，命令退出码为 0。

检查包括：入口、注册表中每个关卡的 `#map=`、两个编辑器、沙盘、01–04 的大师示范与分数、两个编辑器的试算/下载/试玩、全港跑一轮、选区后只算该区、切关卡进第三关、AI 示例进第三关、三语来源与示例文案、小屏提示只出现一次。虚拟时间只用于快进原有示范动画，实际走同一套界面和规则引擎。

需要核对本机 `/feeder/` 与离线单文件的默认行为时，增加两个目录（原项目仍只读）：

```powershell
node game-feeder/tools/deploy/check_site.js <site路径> --playwright=<已有Playwright目录> --local=<改后v7目录> --baseline=<原项目v7目录>
node game-feeder/tools/check_strings.js
```

离线包需先在副本上运行 `python game-feeder/v7/build.py`；网页打包不需要运行它。`shared/site.js` 源文件始终为 `static:false, ai:true, dataMap:true, board:true, submit:''`。只有输出的网站使用静态开关。**不要把 `site/feeder/shared/site.js` 倒拷到源码。**

这里的本机回归使用静态服务器挂载 `/feeder/`，对照原版检查默认配置、入口/导航和页面状态；未启动真实 FastAPI，也未调用登录、排行榜等后台接口。离线回归实际打开单文件。受保护引擎、数据、关卡另做字节级核对。这些检查不代替 Claude 的真鼠标体验和部署后的实际网站检查。

## 3. 方法一：网页直接上传（最简单，不装东西）

以下每一步都由发起人自己在浏览器里点：

1. 自己登录 Cloudflare 后台。
2. 打开 **Workers & Pages → 创建 → Pages → 上传资产 / Direct Upload**（后台可能调整按钮名称）。
3. 拖入生成好的整个 `site` 文件夹，确认顶层有 `_headers`、`_redirects`、`404.html` 和 `feeder`。
4. 起一个项目名，自己点击部署。完成后得到 `项目名.pages.dev`。
5. 打开公开网址，根地址应进入 `/feeder/`。电脑、手机各检查一次；特别看入口、编辑器下载、沙盘和 AI 示例。
6. 更新时进入**同一个 Pages 项目**，点“创建新部署”，再拖入新生成的文件夹。继续用同一个网址。也可在部署记录中回滚旧版本。

网页拖放的文件数上限是 **1,000 个文件**，单文件不得超过 **25 MiB**；超过拖放上限用方法二。Pages 每次上传的文件总上限 **20,000**，本工具也会检查。后台若显示不同配额，以当前账号控制台提示为准。本次包的精确数目见随包说明和构建报告。

## 4. 方法二：发起人自己用 Wrangler

这是上线步骤，Codex 本任务没有执行。需要本机有 Node，首次 `npx` 可能提示下载 Wrangler：

```powershell
npx wrangler login
```

浏览器打开后，由发起人自己登录和授权。然后进入 `site` 的上一级目录，用确定好的项目名执行（把尖括号占位换掉）：

```powershell
npx wrangler pages deploy site --project-name <名字>
```

若文件夹叫 `TransitLab-site`，将 `site` 换成对应名称或完整路径。之后每次更新使用同一个项目名，不创建第二个公开网址。

## 5. 本次开关、缓存与来源

- 静态版隐藏全港数据地图卡、沙盘数据地图链接；排行榜/登录按钮不创建，也不发请求。关卡包上传仍关闭。
- AI 正式版稍后开放。现在完全在浏览器里识别这五类示例：启德、沙田、铜锣湾、将军澳隧道、北部都会区；然后由浏览器 worker 裁剪关卡、试算门槛并打开第三关。它不会任意理解新句子。
- 编辑器导出 `.json` 后显示交法。默认 `submit:'發給發起人'`；日后改打包脚本 `STATIC` 配置中的这个字段即可（可写群组名，不填私人邮箱电话）。它是纯文字，不是上传地址。
- `_headers` 令 HTML 每次重新验证，JS/CSS 缓存 5 分钟后重新验证，`feeder/hk/*.json` 缓存 1 小时后重新验证。文件名没有版本号，不要改成长缓存。
- 测试期全站有 `X-Robots-Tag: noindex`。正式允许搜索引擎收录时，移除 `tools/deploy/_headers` 中的该行，以及模板 `index.html`、`404.html` 中的 `meta name="robots"`，重新打包部署。
- 地图左下图层卡下面公开显示 `© OpenStreetMap contributors (ODbL)`，并标明规划署、地政总署、运输署、GTFS/TransitLab 推算。对应原始出处在 `hk-base.json.sources` 与 `hk-shapes.json.source`；这些数据文件未修改。OSM 铁路走向及衍生数据依 ODbL 使用，模型结果仅供学习。
- 静态 HTML 不再请求 Google Fonts，使用现有 CSS 的系统后备字体；本机和离线源码引用维持原样。
- `shared/levelgen/bot.js`、`check.js` 是任务指定必须保留的**浏览器运行库**，用来出关卡和校验；不含项目 `bots/` 下的离线机器人、测试脚本、Python 或结果目录。

## 6. 发布前逐项检查

- [ ] `build_static.py` 成功，禁止清单、疑似密钥、大小/数量和引用检查通过。
- [ ] `check_site.js` 返回 PASS；`node game-feeder/tools/check_strings.js` 通过。
- [ ] Claude 审查本增量，并用真鼠标体验核心流程。
- [ ] 电脑和手机各打开一次：手机沙盘提示可关闭，地图上可见来源。
- [ ] 上传根目录是完整 `site`；检查报告、说明、增量包都在上传目录外。
- [ ] 发起人自己发布，部署后核对根路径 302、404、缓存头和 noindex。

## 7. 以后再做

GitHub 自动部署、自有域名、AI 后台、全港数据地图、登录和排行榜留到下一版。本次没有连接 GitHub、创建云端项目或绑定域名。若后来想用 Git 集成，先由发起人在 Cloudflare 确认当前 Direct Upload 项目是否支持切换；必要时新建 Git 集成项目并迁移域名。后台部署时把 v7 挂回 `/feeder/`，恢复默认站点配置即可，游戏链接结构保持一致。
