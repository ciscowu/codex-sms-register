# codex-registrar2

基于本地浏览器自动化的 Codex OAuth 注册脚本。

当前 README 仅保留已从代码确认过的行为，不包含历史方案、外部服务宣传或未验证说明。

## 已确认的运行方式

- 入口是 `index.js`
- 运行时会在本机启动浏览器自动化，不是 Browserbase 之类的远程浏览器模式
- 浏览器控制使用 `puppeteer-real-browser`
- OAuth 回调通过捕获浏览器里的 `localhost` 请求 URL 解析授权码，不依赖本地 HTTP 回调服务
- 现已提供 `Dockerfile` 与 `docker-compose.yml`，可在容器内通过 `xvfb-run` 启动图形浏览器

## 已确认的依赖

- Node.js 18+
- `npm install`
- 可用的本地浏览器运行环境
- HeroSMS API Key
- 临时邮箱服务后台接口

`package.json` 当前依赖：

- `axios`
- `dotenv`
- `puppeteer-core`
- `puppeteer-real-browser`
- `ws`

## 配置文件

程序读取仓库根目录的 `config.json`。

当前代码会读取这些字段：

```json
{
  "heroSmsApiKey": "",
  "heroSmsService": "dr",
  "heroSmsCountry": 16,
  "mailBaseUrl": "",
  "mailAdminPassword": "",
  "mailSitePassword": "",
  "mailDomain": "",
  "proxyHost": "",
  "proxyPort": 0,
  "proxyUsername": "",
  "proxyPassword": "",
  "cpa_url": "",
  "cpa_key": "",
  "oauthClientId": "app_EMoamEEZ73f0CkXaXp7hrann",
  "oauthRedirectPort": 1455,
  "tokenOutputDir": "",
  "tokenOutputDirs": []
}
```

完整流程实际会用到的核心字段：

- `heroSmsApiKey`
- `mailBaseUrl`
- `mailAdminPassword`
- `mailDomain`
- `cpa_url` / `cpa_key`（如需在换到 token 后自动上传 auth JSON）

代码已确认的默认值：

- `heroSmsService`: `dr`
- `heroSmsCountry`: `16`
- `oauthClientId`: `app_EMoamEEZ73f0CkXaXp7hrann`
- `oauthRedirectPort`: `1455`
- `tokenOutputDir`: 未配置时回退到 `CODEX_DATA_DIR/tokens/`，未设置 `CODEX_DATA_DIR` 时再回退到当前目录下的 `tokens/`
- `CODEX_DATA_DIR`: 未设置时回退到当前工作目录

## 使用方式

单次完整流程：

```bash
node index.js 1
```

批量完整流程：

```bash
node index.js 5
```

`--phase2` 模式：

- 从 `accounts.json` 里找一个 `status === "registered"` 且带密码的账号
- 执行 Phase 1.5、Phase 2、Phase 3

```bash
node index.js --phase2
```

`--phase8` 模式：

- 读取 `username.json`
- 按邮箱登录 OAuth
- 成功后换取并保存 token
- 失败记录追加到 `error_account.json`

```bash
node index.js --phase8
```

## Docker 运行

准备：

- 在仓库根目录提供 `config.json`
- 首次运行前创建宿主机目录 `data/`

单次完整流程：

```bash
docker compose run --rm registrar 1
```

批量完整流程：

```bash
docker compose run --rm registrar 5
```

`--phase2` / `--phase8`：

```bash
docker compose run --rm registrar --phase2
docker compose run --rm registrar --phase8
```

容器内约定：

- `config.json` 只读挂载到 `/app/config.json`
- `CODEX_DATA_DIR=/app/data`
- `accounts.json` / `username.json` / `error_account.json` / `tokens/` 都会写到挂载出来的 `data/` 目录

## 已确认的流程

完整流程分四步：

1. `phase1`
   用 HeroSMS 获取手机号，完成 ChatGPT 手机号注册，并把账号写入 `accounts.json`
2. `phase1_5`
   首次登录 ChatGPT，补全个人资料
3. `phase2`
   创建临时邮箱，完成手机号登录后的邮箱绑定，并把结果追加到 `username.json`
4. `phase3`
   用邮箱重新走 OAuth，拿授权码并换取 token

`phase8` 是独立补跑流程，不依赖当次注册：

1. 读取 `username.json`
2. 按邮箱走 OAuth
3. 成功后保存 token
4. 失败时把原记录追加到 `error_account.json`

## 输出文件

当前代码会直接读写这些文件：

- `accounts.json`
- `username.json`
- `error_account.json`
- `tokens/` 或 `tokenOutputDir` / `tokenOutputDirs`

如果设置了 `CODEX_DATA_DIR`，以上默认文件会改为写入该目录下。

token 文件名格式已确认是：

```text
codex-{email}-free.json
```

token 文件包含这些字段：

- `access_token`
- `account_id`
- `disabled`
- `email`
- `expired`
- `id_token`
- `last_refresh`
- `refresh_token`
- `type`

如果配置了 `cpa_url` 和 `cpa_key`：

- 每次成功换到 token 并生成 JSON 后，会额外上传一份 `codex-{email}.json`
- 上传接口是 `POST {cpa_url}/v0/management/auth-files`
- 表单字段固定包含 `file` 和 `channel=codex`
- 上传失败只记日志，不回滚本地 token 文件

## 代理行为

- 如果配置了 `proxyHost`，浏览器和 token 交换都会先尝试走代理
- 若检测到代理连接失败，主流程会自动切换为直连重试当前轮任务
- 若 token 交换时 Node 网络层失败，代码会尝试回退到 `curl`

## 运行限制

- Linux 下默认仍会拒绝 `xvfb-run` 环境；设置 `ALLOW_XVFB=1` 或在 Docker 容器内运行时会放行
- 浏览器启动参数里固定包含 `--no-sandbox`
- Docker 启动脚本会自动通过 `xvfb-run` 提供虚拟显示

## 已知现状

- 文档历史内容已过时时，应以代码为准
- 当前代码里没有   接入
- 当前代码里没有内置本地 HTTP OAuth 回调服务
