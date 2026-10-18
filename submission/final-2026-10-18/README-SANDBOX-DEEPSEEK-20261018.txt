TransitLab HK · 第二公网沙盘包

这个包包含一套可单独部署的五模式站点：
- /feeder/mode1-bus/ 至 /feeder/mode4-tod/：前四关卡的轻量入口；
- /feeder/mode5-sandbox/：主要演示沙盘；
- /feeder/：五模式入口。

沙盘现场演示顺序
1. 选择「改人口」，点一个分区，拖动人数滑杆；状态会写入底部操作记录。
2. 点地图空白处即可取消选区；点击「画线」后拖动，线段会以动态预览显示并在松开后提交。
3. 点「放站」，再点任一陆地区域；系统会沿可行路径接到该处并立即放站，底部会出现独立记录。
4. 点击「跑到稳定」，逐轮结果和道路变化会更新。也可以按住 F 加速。
5. 「AI 出关卡」有三个固定问题，也接受自然语言；没有 API 时自动使用内置示例，有 API 时调用服务器端 DeepSeek。
6. 右下工具栏的 3D 可切换轻量立体视图。排行榜只在注册并登录后允许提交成绩。

安全原则
DeepSeek Key 只放服务器根目录 .env。不要把它写进 ai/client.js、HTML、ZIP 前端目录或截图。前端只请求同源 /api/feeder/ai/*。

本地启动（需要 Python 3.12）
  Copy-Item .env.example .env
  pip install -r backend/requirements.txt
  uvicorn backend.main:app --host 127.0.0.1 --port 8000
  浏览器打开 http://127.0.0.1:8000/feeder/mode5-sandbox/

腾讯云 Ubuntu / Docker 部署
1. 购买轻量应用服务器或 CVM，系统选 Ubuntu 22.04 LTS；安全组放行 TCP 22、80、443。登录后执行：
   sudo apt update
   sudo apt install -y docker.io docker-compose-plugin unzip
   sudo systemctl enable --now docker
2. 在 Windows PowerShell 上传 ZIP：
   scp "C:\路径\transitlab-v7-sandbox-ai-deepseek-20261018.zip" ubuntu@你的公网IP:/home/ubuntu/
3. 服务器解压并进入目录：
   mkdir -p /home/ubuntu/transitlab-sandbox
   unzip -o /home/ubuntu/transitlab-v7-sandbox-ai-deepseek-20261018.zip -d /home/ubuntu/transitlab-sandbox
   cd /home/ubuntu/transitlab-sandbox
4. 配置密钥（只在服务器操作）：
   cp .env.example .env
   nano .env
   填入 DEEPSEEK_API_KEY=你的 DeepSeek Key、DEEPSEEK_MODEL=deepseek-chat。
   DEEPSEEK_BASE_URL 保持 https://api.deepseek.com，不要改成前端可控地址。
5. 启动：
   sudo docker compose -f deploy/docker-compose.yml build --no-cache
   sudo docker compose -f deploy/docker-compose.yml up -d --force-recreate
   sudo docker compose -f deploy/docker-compose.yml ps
6. 验收：
   curl http://127.0.0.1/api/health
   curl http://127.0.0.1/api/feeder/ai/status
   浏览器打开 http://你的公网IP/feeder/mode5-sandbox/

QQ 邮箱注册验证码（可选）
只有希望注册流程发送邮件时才需要配置。登录 QQ 邮箱网页版 → 设置 → 账户 → 开启 SMTP 服务 → 生成“授权码”。把邮箱写入 SMTP_USER，把授权码写入 SMTP_PASSWORD；这里填的是授权码，不是 QQ 登录密码。设置 SMTP_FROM=同一个 QQ 邮箱后重建容器。没有 SMTP 时，演示模式会自动启用新账号，不会把邮箱密码交给前端。

更新代码
上传新 ZIP 后，在目录执行同一组 build 与 up 命令即可。数据和账号数据库挂载在 data/app，重建容器不会丢失。
