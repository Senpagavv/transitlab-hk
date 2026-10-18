TransitLab HK · 第二公网沙盘包（UI 简化版）

这个包包含一套可单独部署的五模式站点：
- /feeder/：五模式入口；
- /feeder/mode1-bus/ 至 /feeder/mode4-tod/：前四关卡；
- /feeder/mode5-sandbox/：完整沙盘，包含改人口、动态画线、放站、运行、AI 生成关卡、排行榜和轻量 3D 视图；
- /feeder/demo-static/mode1.html 与 /feeder/demo-static/mode4.html：不需要注册、适合现场备用的静态演示页。

本次 UI 合并
- 已合并组员的 tl-simplify.css / tl-simplify.js 到 shared/，前四关和沙盘都会使用；
- 次要说明折叠到“规则”和“图例”，地图卡片整理到右侧信息栏；
- 沙盘信息按组员设计折叠，点击“片区”折叠条即可展开人口控制；
- 第一关绿圈按照实际 servedRatio 绘制，50% 是半圈、80% 是五分之四圈、100% 是整圈；
- 第四关静态海报的多次运行使用固定基线，不会把百分比重复累加。

沙盘现场演示顺序
1. 选择“改人口”，点一个分区并拖动人数滑杆；状态会写入底部操作记录。
2. 点地图空白处取消选区；点击“画线”后拖动，动态预览线段，松开后提交。
3. 点击“放站”，再点任一陆地区域；系统立即把站点放到该区域并记录操作。
4. 点击“跑到稳定”，观察逐轮结果和道路变化；按住 F 可以加速。
5. “AI 出关卡”提供三个固定问题，也接受自定义描述；没有 API 时使用内置示例，有 API 时走服务器端 DeepSeek。
6. 右下工具栏“3D”可以切换轻量立体视图。排行榜只对登录用户开放。

DeepSeek 安全原则
DeepSeek Key 只放服务器根目录 .env。不要写进 ai/client.js、HTML、ZIP 前端目录或截图。前端只请求同源 /api/feeder/ai/*，浏览器不会看到 Key。

UI 简化脚本
根目录的 apply.py 是组员交付包原始安装脚本，可以把 tl-simplify.css/js 安装到另一份 v7-deploy 源码：
  python apply.py --repo ./game-feeder/v7-deploy
预览修改：
  python apply.py --repo ./game-feeder/v7-deploy --dry-run

本地启动（需要 Python 3.12）
  Copy-Item .env.example .env
  pip install -r backend/requirements.txt
  uvicorn backend.main:app --host 127.0.0.1 --port 8000
  浏览器打开 http://127.0.0.1:8000/feeder/mode5-sandbox/

腾讯云 Ubuntu / Docker 部署
1. 购买 Ubuntu 22.04 LTS 轻量应用服务器或 CVM，安全组放行 TCP 22、80、443。
2. 在 Windows PowerShell 上传 ZIP：
   scp "C:\路径\transitlab-v7-sandbox-deepseek-ai-UI-SIMPLIFIED-20261018-GROUP.zip" ubuntu@你的公网IP:/home/ubuntu/
3. SSH 后执行：
   sudo apt update
   sudo apt install -y docker.io docker-compose-plugin unzip
   sudo systemctl enable --now docker
   mkdir -p /home/ubuntu/transitlab-sandbox
   unzip -o /home/ubuntu/transitlab-v7-sandbox-deepseek-ai-UI-SIMPLIFIED-20261018-GROUP.zip -d /home/ubuntu/transitlab-sandbox
   cd /home/ubuntu/transitlab-sandbox
4. 配置服务器密钥：
   cp .env.example .env
   nano .env
   填入 DEEPSEEK_API_KEY、DEEPSEEK_BASE_URL=https://api.deepseek.com、DEEPSEEK_MODEL=deepseek-chat。
5. 构建并启动：
   sudo docker compose -f deploy/docker-compose.yml build --no-cache
   sudo docker compose -f deploy/docker-compose.yml up -d --force-recreate
   sudo docker compose -f deploy/docker-compose.yml ps
6. 验收：
   curl http://127.0.0.1/api/health
   curl http://127.0.0.1/api/feeder/ai/status
   浏览器打开 http://你的公网IP/feeder/ 。

QQ 邮箱注册验证码（可选）
只有需要注册流程发送邮件时才配置。QQ 邮箱网页版 → 设置 → 账户 → 开启 SMTP 服务 → 生成“授权码”。
在 .env 填：
  SMTP_HOST=smtp.qq.com
  SMTP_PORT=465
  SMTP_USER=你的QQ邮箱
  SMTP_PASSWORD=QQ邮箱设置生成的SMTP授权码
  SMTP_FROM=你的QQ邮箱
SMTP_PASSWORD 是授权码，不是 QQ 登录密码。不要把它或 DeepSeek Key 发到聊天里。
没有 SMTP 时，演示模式会自动启用新账号，不会把邮箱密码交给前端。

更新代码
上传新 ZIP 后，在部署目录重复 build 和 up。data/app 挂载的是账号与排行榜数据，重建容器不会丢失。





