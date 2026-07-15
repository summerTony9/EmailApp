# EmailApp

跨 macOS/Windows 的桌面批量发信工具。客户端导入企业名单后，通过本机 SMTP 发送固定模板邮件；每封发送前访问服务端确认邮箱是否已发，SMTP 成功后再写入服务端已发记录。

## 功能

- 桌面端：Tauri + React + TypeScript
- 服务端：Fastify + SQLite + Docker Compose
- 导入：CSV / XLSX，两列为企业名和邮箱
- 去重：按邮箱去重
- 每次批量发送可设置实际上限，服务端已发记录会跳过且不占用本次额度
- 服务端默认地址：`http://43.156.180.151:8080`
- 邮件主题：`知识产权质押融资服务提示`
- 邮件模板中涉及 `1.2%左右` 的利率表述会在 HTML 版本中标红加粗
- SMTP 密码按需求明文保存在本机配置文件，不上传服务器
- 服务端已发记录按 90 天判断有效期，超过 90 天后同一邮箱可以再次发送，已有记录不会在启动时被删除

## 服务端部署

服务器 `43.156.180.151` 上可以按下面命令部署。若服务器尚未安装 Docker，先执行：

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

执行完 `usermod` 后退出服务器并重新登录，让 Docker 用户组生效。

拉代码并启动后端：

```bash
git clone https://github.com/summerTony9/EmailApp.git
cd EmailApp
cp .env.example .env
openssl rand -hex 32
```

把上一步生成的随机字符串填到 `.env`：

```bash
nano .env
```

`.env` 示例：

```env
API_TOKEN=replace-with-the-random-token
HOST_PORT=8080
```

如果服务器提示 `address already in use`，说明宿主机端口被占用。先查看是谁占用了 8080：

```bash
sudo ss -ltnp | grep ':8080'
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

如果不想停掉占用 8080 的服务，可以把 `.env` 改成：

```env
API_TOKEN=replace-with-the-random-token
HOST_PORT=8081
```

然后桌面端的服务端地址也改成：

```text
http://43.156.180.151:8081
```

启动服务：

```bash
docker compose up --build -d
```

验证服务：

```bash
docker compose ps
curl http://127.0.0.1:${HOST_PORT:-8080}/health
curl http://43.156.180.151:${HOST_PORT:-8080}/health
```

日常更新：

```bash
cd EmailApp
git pull
docker compose up --build -d
docker compose logs -f emailapp-server
```

停止服务：

```bash
docker compose down
```

服务端会把 SQLite 数据保存在 Docker volume `emailapp_emailapp-data` 中，重启或重新构建镜像不会清空已发记录。

已发记录按 `sent_at` 计算 90 天有效期。更新到包含过期逻辑的版本后，不需要手动迁移数据库，服务器里已有的邮箱不会在服务启动时被删除；超过 90 天的记录只是在 `/api/check` 时不再判定为已发送。再次发送成功并写入 `/api/sent` 时，服务端会先把旧记录复制到 `sent_record_history`，再刷新 `sent_records` 中该邮箱的当前记录。

## 云端定时发信服务

如果希望在云服务器上独立运行一个“每天定时、定量自动发邮件”的服务，使用新增的 `cloud-mailer`。它是一个单独 Docker 服务，带 Web 控制台、名单导入、SMTP 配置、每日定时任务、手动立即发送和发送日志；不会和当前 `emailapp-server` 混在一起，也不会共用原来的 SQLite 数据卷。

首次部署：

```bash
git clone https://github.com/summerTony9/EmailApp.git
cd EmailApp
cp .env.example .env
openssl rand -hex 32
nano .env
```

在 `.env` 里至少配置：

```env
MAILER_ADMIN_TOKEN=replace-with-the-random-token
MAILER_HOST_PORT=8090
```

启动独立云端发信服务：

```bash
docker compose -f docker-compose.cloud-mailer.yml up --build -d
```

验证：

```bash
curl http://127.0.0.1:${MAILER_HOST_PORT:-8090}/health
docker compose -f docker-compose.cloud-mailer.yml logs -f emailapp-cloud-mailer
```

浏览器打开：

```text
http://服务器IP:8090
```

用 `.env` 里的 `MAILER_ADMIN_TOKEN` 登录控制台后：

1. 填写 SMTP 服务器、端口、加密方式、账号、授权码、发件人邮箱。
2. 设置每日发送时间、时区、每日上限和每封间隔秒数。
3. 导入 CSV 或 XLSX 名单，字段为企业名、邮箱；已发送成功的邮箱不会被重新置为待发送。
4. 先发送测试邮件，确认 SMTP 可用后再启用定时任务。
5. 如需立刻处理当天额度，可点击“立即发送”。

云端定时发信服务的数据保存在 Docker volume `emailapp-cloud-mailer-data` 中。SMTP 授权码会保存在这个服务自己的 SQLite 数据库里；建议只在可信网络访问控制台，或在服务器前面加 HTTPS 反向代理和安全组/IP 白名单。云服务器安全组也需要允许容器访问对应 SMTP 出站端口，例如 465 或 587。

日常更新：

```bash
cd EmailApp
git pull
docker compose -f docker-compose.cloud-mailer.yml up --build -d
```

停止：

```bash
docker compose -f docker-compose.cloud-mailer.yml down
```

本地开发部署步骤：

1. 复制环境变量：

   ```bash
   cp .env.example .env
   ```

2. 修改 `.env` 里的 `API_TOKEN`。

3. 启动服务：

   ```bash
   docker compose up --build -d
   ```

4. 验证健康检查：

   ```bash
   curl http://43.156.180.151:8080/health
   ```

## 自动打包

GitHub Actions 已配置 macOS 和 Windows 自动打包。

- 每次推送到 `main`：在 GitHub 仓库的 `Actions` -> `CI` -> 对应运行记录里下载 artifacts。
- macOS 产物名：`EmailApp-macOS`，包含 `.dmg` 和 `.app`。
- Windows 产物名：`EmailApp-Windows`，包含 `.msi` 和/或 `.exe`。
- 推送 `v*` tag 时会自动创建 GitHub Release，并把安装包上传到 Release。
- 当前没有配置 Apple Developer ID 或 Windows 代码签名证书，安装包是未签名版本；macOS 首次打开可能需要右键打开，Windows 可能出现 SmartScreen 提示。

发一个版本示例：

```bash
git add .
git commit -m "Initial EmailApp implementation"
git push -u origin main
git tag v0.1.0
git push origin v0.1.0
```

## 导入历史已发名单

如果你手上已有一份“以前已经发过”的企业名单，可以在桌面端直接写入服务器已发记录，后续正式群发时这些邮箱会自动跳过。

操作流程：

1. 打开桌面 App，填好 `服务端地址` 和 `API Token`。
2. 确认支行名、行长名、客户经理和电话已填写。
3. 点击 `导入名单`，选择 CSV/XLSX 文件。
4. 检查预览表格里企业名和邮箱是否识别正确。
5. 点击 `导入为已发`。

这个操作只写入服务器数据库，不会发送邮件，也不需要填写 SMTP 服务器或 SMTP 密码。名单格式仍然是两列：企业名、邮箱；去重仍然只按邮箱判断。

## SMTP 配置

发送测试邮件失败并出现 `connection closed via error` 时，通常是 SMTP 端口和加密方式不匹配。

常见组合：

- `465`：选择 `SSL/TLS`
- `587`：选择 `STARTTLS`
- `25`：选择 `不加密`，仅适合内网或明确允许的 SMTP 服务

多数企业邮箱、QQ 邮箱、网易邮箱使用的是授权码，不是网页登录密码。若连接方式正确但仍失败，检查账号是否开启 SMTP 服务、是否使用授权码、服务器安全组是否允许访问对应端口。

桌面端底部有 `运行日志` 面板。测试邮件失败时，日志会显示 SMTP 主机、端口、加密方式、发件人/收件人、发送阶段和底层错误链；日志不会记录 SMTP 密码或 API Token。

## 分批发送上限

桌面端配置里的 `每次发送上限` 控制单次点击 `开始批量发送` 最多实际发出的邮件数。填 `0` 表示不限制；例如填 `50`，这次任务最多成功发出 50 封后会停止，剩余名单保持待发送。再次点击发送时，客户端会从第一个未完成企业继续；已经写入服务端已发记录的邮箱也会自动跳过，并且这些跳过记录不占用新的 50 封额度。发送过程中可以点击 `暂停` 临时挂起任务，点击 `继续` 恢复；点击 `停止` 会在当前邮件处理完后结束任务，后续再次点击开始会继续处理未完成企业。

## 客户端开发

如果本机 Rust 版本较旧，构建 Tauri 前先升级 Rust stable：

```bash
rustup update stable
rustup default stable
```

安装依赖：

```bash
npm --prefix client install
npm --prefix server install
```

运行桌面端：

```bash
npm run client:dev
```

运行服务端：

```bash
npm run server:dev
```

运行测试：

```bash
npm test
```

## API

所有 `/api/*` 请求都需要：

```text
Authorization: Bearer <API_TOKEN>
```

- `GET /health`
- `POST /api/check`，body: `{ "email": "demo@example.com" }`，只会把 90 天内的已发记录判定为 `sent: true`
- `POST /api/sent`，body: `{ "email": "...", "companyName": "...", "managerName": "...", "managerPhone": "...", "branchName": "...", "presidentName": "...", "subject": "..." }`
