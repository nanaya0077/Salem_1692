# 把《女巫镇》在线版部署到 Railway 的一手事实（W-03）

> 研究票：W-03（Railway 部署可行性前置调研）
> 日期：2026-11-06
> 范围：单进程 Node + WebSocket 服务从 GitHub 仓库部署到 Railway 的构建、端口、健康检查、长连接、实例、计费、区域、域名事实
> 读法：每条事实后跟官方链接；标「未找到官方依据」的条目是逐页翻过 Railway / Nixpacks / Node 官方文档后仍无明文的项，不做推测填空

## 0. 一句话结论

- **Railway 的默认构建器已经是 Railpack，不是 Nixpacks**，`railway.toml` 的 `build.builder` 只剩 `RAILPACK` 与 `DOCKERFILE` 两个取值（[Railpack](https://docs.railway.com/builds/railpack)、[Config as Code 参考](https://docs.railway.com/config-as-code/reference)）。本仓库根目录没有 `package.json`，Railpack 的 Node 检测（要求根目录有 `package.json`）不命中，所以必须显式给 Root Directory、或写 build/start 命令、或上 Dockerfile。
- **Nixpacks 默认 Node 18，只能指定主版本**；固定顺序是 `NIXPACKS_NODE_VERSION` → `engines.node` → `.nvmrc` → `.node-version`，源码里 Node 24 已进入可选列表，`>=18` 会被解析成 24（[Nixpacks Node 文档](https://nixpacks.com/docs/providers/node)、[Nixpacks 源码](https://github.com/railwayapp/nixpacks/blob/main/src/providers/node/mod.rs)）。
- **Node 24 是官方 LTS（Krypton）**，Node 官方只建议生产使用 Active LTS 或 Maintenance LTS，因此 `node:24` 基础镜像是站得住的选择（[Node 版本表](https://nodejs.org/en/about/previous-releases)）。
- **`PORT` 由 Railway 注入，健康检查也读这个值**；只有配了 `healthcheckPath` 才会探测，默认 300 秒拿不到 2xx 就把这次部署判为 failed，上线之后不再探活（[Healthchecks](https://docs.railway.com/deployments/healthchecks)）。「必须监听 `0.0.0.0`」在官方文档里**未找到依据**，官方明文只要求监听 `PORT`。
- **WebSocket 被官方明确豁免空闲与时长上限**，"can stay open indefinitely, even while idle"；同时 Railway **不支持 sticky session**，多副本会把同一局玩家打散，所以游戏服务要钉在单副本（[Edge 规格与限制](https://docs.railway.com/networking/public-networking/specs-and-limits)、[Scaling](https://docs.railway.com/deployments/scaling)）。
- **Hobby $5/月，含 $5 资源额度；另有 Free 计划 $0/月、每月 $1 额度**，新账号 Trial 一次性 $5、最长 30 天（[Plans](https://docs.railway.com/pricing/plans)、[Free Trial](https://docs.railway.com/pricing/free-trial)）。
- **区域里确有新加坡**：Southeast Asia Metal / Singapore / `asia-southeast1-eqsg3a`，在 service settings 里选，默认跟随账号的 preferred region（[Regions](https://docs.railway.com/deployments/regions)）。
- **域名**：默认给 `*.up.railway.app`；绑自定义域名要同时加 `CNAME` 与 `TXT` 两条记录，TLS 证书由 Railway 自动签发与续期（[Public Networking](https://docs.railway.com/networking/public-networking)、[Edge 规格与限制](https://docs.railway.com/networking/public-networking/specs-and-limits)）。

---

## 1. 构建流程：Railpack 是默认，Nixpacks 已从配置项里消失

### 1.1 三种路径

| 路径 | 触发条件 | 配置位置 | 出处 |
| --- | --- | --- | --- |
| Railpack（零配置） | 新 service 默认走这条 | 环境变量或 Railpack config file | [Railpack](https://docs.railway.com/builds/railpack) |
| 自定义 Dockerfile | 仓库里能找到 Dockerfile 就**总是**用它构建 | `build.dockerfilePath`，默认 `Dockerfile`（也可用 `RAILWAY_DOCKERFILE_PATH`） | [Config as Code](https://docs.railway.com/config-as-code/reference)、[变量参考](https://docs.railway.com/variables/reference) |
| `railway.toml` / `railway.json` | 代码里存在该文件 | 默认查找这两个文件名 | [Config as Code](https://docs.railway.com/config-as-code/reference) |

- Railpack 官方描述是 "Railway uses Railpack to build and deploy your code with zero configuration"，四步流程为：分析语言与框架 → 装运行时与依赖 → 用检测到或配置的命令构建 → 打包成镜像（[Railpack](https://docs.railway.com/builds/railpack)）。
- **Config as Code 已被标为 deprecated**，页面 banner 写 "Prefer Infrastructure as Code"，旧文件对 legacy service 可用到 2026-12-01；但 `railway.toml` / `railway.json` 的字段说明仍是当前唯一可查的字段清单（[Config as Code](https://docs.railway.com/config-as-code/reference)）。
- 代码里的配置**覆盖** dashboard 设置，且只作用于该次部署，不回写 dashboard（[Config as Code](https://docs.railway.com/config-as-code/reference)）。
- 优先级：环境级代码配置 > 基础代码配置 > service settings（[Config as Code](https://docs.railway.com/config-as-code/reference)）。

### 1.2 build / start 命令写在哪

| 项 | 位置 | 出处 |
| --- | --- | --- |
| build command | service settings；代码侧 `build.buildCommand` | [Build and Start Commands](https://docs.railway.com/builds/build-and-start-commands)、[Config as Code](https://docs.railway.com/config-as-code/reference) |
| start command | service settings；代码侧 `deploy.startCommand` | 同上 |
| Dockerfile 路线的 start | 默认取 Dockerfile 的 `ENTRYPOINT` / `CMD` | [Build and Start Commands](https://docs.railway.com/builds/build-and-start-commands) |
| install 命令 | `RAILPACK_INSTALL_CMD` | [Build Configuration](https://docs.railway.com/builds/build-configuration) |

注意：start command 里要用 `$PORT` 必须包一层 shell，`exec form` 不做变量展开，官方给的写法是 `/bin/sh -c "exec python main.py --port $PORT"`（[Build and Start Commands](https://docs.railway.com/builds/build-and-start-commands)）。

### 1.3 没有根 package.json 的 monorepo 怎么写

- **Root Directory 默认 `/`**，是给 monorepo 用的；但 **Railway Config File 不跟随 Root Directory**，必须写绝对路径，例如 `/backend/railway.toml`（[Build Configuration](https://docs.railway.com/builds/build-configuration)）。
- 官方把 monorepo 分成两类：**isolated**（各子目录互不共享依赖）靠 Root Directory 解决；**shared**（共享根目录配置，如 workspaces）靠给每个 service 配自定义 build / start 命令解决（[Monorepo](https://docs.railway.com/deployments/monorepo)）。
- 官方 CLI 写法（两种都直接可抄）：

```bash
# isolated：直接指到子目录
railway environment edit --service-config backend source.rootDirectory /backend

# shared：在根目录按包过滤
railway environment edit --service-config backend build.buildCommand "pnpm --filter backend build"
railway environment edit --service-config backend deploy.startCommand "pnpm --filter backend start"
```

- 从 railway.com/new 导入 JS monorepo 时，官方会自动给每个"可部署包"stage 一个 service：支持 pnpm / npm / yarn / bun，自动配 service name、`pnpm --filter [package] start`、build command、watch paths（如 `/packages/backend/**`），并过滤掉 eslint / prettier / tsconfig / test 这类不可部署包（[Monorepo](https://docs.railway.com/deployments/monorepo)）。
- **落到本仓库**：根目录只有 `apps/`、`packages/`、`docs/` 等目录，没有 `package.json`（本机 `Test-Path package.json` = False），所以自动检测不会命中 Node provider；可行写法是二选一（此为本文推论，非官方原文）：把 Root Directory 指到 `apps/<服务目录>`，或在根 `railway.toml` 里显式给 `build.buildCommand` / `deploy.startCommand`。

---

## 2. Node 版本

### 2.1 Nixpacks 侧的默认值与可选值

| 项 | 值 | 出处 |
| --- | --- | --- |
| 默认主版本 | **18**（`DEFAULT_NODE_VERSION: u32 = 18`） | [Nixpacks 源码](https://github.com/railwayapp/nixpacks/blob/main/src/providers/node/mod.rs) |
| 文档列出的可选主版本 | 16 / 18 / 20 / 22 / 23 | [Nixpacks Node 文档](https://nixpacks.com/docs/providers/node) |
| 源码里的 `AVAILABLE_NODE_VERSIONS` | 14、16（均标 EOL）、18、20、22、**24** | [Nixpacks 源码](https://github.com/railwayapp/nixpacks/blob/main/src/providers/node/mod.rs) |
| 精度 | **只能指定主版本**（如 `18.x`、`20`） | [Nixpacks Node 文档](https://nixpacks.com/docs/providers/node) |

源码与文档不一致时以源码为准：文档的版本表已经落后，24 的 archive hash 已在源码里（[Nixpacks 源码](https://github.com/railwayapp/nixpacks/blob/main/src/providers/node/mod.rs)）。

### 2.2 固定版本的四个入口与顺序

Nixpacks 读取顺序（源码 `get_nix_node_pkg`）：**环境变量 `NODE_VERSION`（即 `NIXPACKS_NODE_VERSION`）→ `package.json` 的 `engines.node` → `.nvmrc` → `.node-version`**（[Nixpacks 源码](https://github.com/railwayapp/nixpacks/blob/main/src/providers/node/mod.rs)）。

| 方式 | 写法 | 说明 |
| --- | --- | --- |
| 环境变量 | `NIXPACKS_NODE_VERSION=24` | 优先级最高（[Nixpacks Node 文档](https://nixpacks.com/docs/providers/node)） |
| `engines` | `"engines": { "node": "24.x" }` | 只保留偶数主版本参与匹配 |
| `.nvmrc` | `24` 或 `lts/*` | `lts/*` 在源码里映射到 **22**，`lts/iron` = 20（[源码](https://github.com/railwayapp/nixpacks/blob/main/src/providers/node/mod.rs)） |
| Dockerfile | `FROM node:24-slim` | 走 Dockerfile 这条路就不经过 Nixpacks / Railpack 的版本解析 |

语义细节：解析时只保留偶数主版本（LTS）并按高到低匹配，所以 `engines.node = ">=18"` 会命中 24，源码测试 `test_latest_lts_version` 正是断言 `nodejs_24`（[Nixpacks 源码](https://github.com/railwayapp/nixpacks/blob/main/src/providers/node/mod.rs)）。

Railpack 侧的顺序不同，写在 `RAILPACK_NODE_VERSION` → `devEngines.runtime` → `engines.node` → `.nvmrc` → `.node-version` → `mise.toml` / `.tool-versions` → **默认 `lts`**，并且只支持"actively maintained Node.js LTS 版本"（[Railpack Node](https://railpack.com/languages/node)）。

### 2.3 Node 24 是否官方支持

| 版本 | 代号 | 首发 | 状态 |
| --- | --- | --- | --- |
| v26 | Lithium | 2026-05-05 | LTS |
| **v24** | **Krypton** | **2025-05-06** | **LTS** |
| v22 | Jod | 2024-04-24 | LTS |
| v20 | Iron | 2023-04-17 | EOL |
| v18 | Hydrogen | 2022-04-18 | EOL |

来源：[Node.js Releases](https://nodejs.org/en/about/previous-releases)。官方原话是 "Production applications should only use Active LTS or Maintenance LTS releases"，24 属 LTS，所以生产可用；反之 18 / 20 已 EOL，不该作为新项目目标版本（[Node.js Releases](https://nodejs.org/en/about/previous-releases)）。

---

## 3. 端口与健康检查

### 3.1 `PORT`

- Railway 向容器注入 `PORT`，**健康检查也用这个值**；若服务不监听 `PORT`（改用 target ports），需要手动设一个 `PORT` 变量，否则健康检查会返回 service unavailable（[Healthchecks](https://docs.railway.com/deployments/healthchecks)）。
- Dockerfile 里要在 start 命令用 `$PORT`，必须 `exec` 形式包 shell，否则变量不展开（[Build and Start Commands](https://docs.railway.com/builds/build-and-start-commands)）。

### 3.2 监听地址

官方文档里能确证的只有"必须监听 `PORT`"这一条（[Healthchecks](https://docs.railway.com/deployments/healthchecks)）。**"必须监听 `0.0.0.0`"未找到官方依据**；`127.0.0.1` 这种只绑回环的地址在容器里对外不可达是一般容器常识，不属本次取证范围。实践上按 `0.0.0.0` 绑定最安全，但这条是工程惯例，不是 Railway 文档明文。

### 3.3 healthcheckPath 配置位置与默认行为

| 项 | 事实 | 出处 |
| --- | --- | --- |
| 是否默认探测 | **不配就不探测** | [Healthchecks](https://docs.railway.com/deployments/healthchecks) |
| 配置位置 | service settings，或代码侧 `deploy.healthcheckPath` / `deploy.healthcheckTimeout` | [Config as Code](https://docs.railway.com/config-as-code/reference) |
| 判定 | 轮询该 endpoint 直到拿到任意 `2xx`，才把新部署切 active | [Healthchecks](https://docs.railway.com/deployments/healthchecks) |
| 默认超时 | **300 秒（5 分钟）**，超时即把部署标记为 failed | 同上 |
| 调整方式 | service settings 或 `RAILWAY_HEALTHCHECK_TIMEOUT_SEC` | 同上、[变量参考](https://docs.railway.com/variables/reference) |
| 探测来源 hostname | 固定 `healthcheck.railway.app`（做 host 白名单要放行） | [Healthchecks](https://docs.railway.com/deployments/healthchecks) |
| 上线后是否持续探活 | **不持续**，只在部署切换期间探测 | 同上 |

### 3.4 挂卷服务与健康检查

为防止数据损坏，**两个部署不能同时 active 并挂载同一个卷**，因此即使配了 healthcheck，挂卷服务的重新部署也会有一小段 downtime（[Healthchecks](https://docs.railway.com/deployments/healthchecks)）。

---

## 4. WebSocket 与长连接

| 维度 | 事实 | 出处 |
| --- | --- | --- |
| 协议 | 支持 HTTP/1.1 与 HTTP/2；**websockets over HTTP/1.1** | [Edge 规格与限制](https://docs.railway.com/networking/public-networking/specs-and-limits) |
| 空闲超时 | HTTP/1.1 连接在两次请求之间 60 秒后关闭，**此条不适用于 HTTP/2 与 websocket** | 同上 |
| WS 豁免（原话） | "Websocket connections are exempt from these duration and inactivity limits, and can stay open indefinitely, even while idle." | 同上 |
| 是否需要开关 | 不需要，文档没有任何额外开关 | 同上 |
| 普通 HTTP 请求上限 | 有数据可跑满 15 分钟；无数据 5 分钟关闭；请求体须 5 分钟内传完 | 同上 |
| 并发连接上限 | 单域名最大 **10,000 并发连接**，约 11,000 RPS，每连接 10,000 请求 | 同上 |
| Header 上限 | 合并 header 32 KB | 同上 |
| Sticky session | **官方明确不支持**："For now Railway does not support sticky sessions" | [Scaling](https://docs.railway.com/deployments/scaling) |

推论（非官方原文）：单副本部署时没有路由选择问题，sticky session 无所谓；一旦把 replicas 调到 2 以上，同一局玩家的 WS 连接会被随机分发到不同实例，内存态房间必然分裂。

---

## 5. 实例与重启语义

### 5.1 副本数

- 副本数在 service settings 里手动调，每个副本拿满计划给单实例的资源（[Scaling](https://docs.railway.com/deployments/scaling)）。
- 创建 / 删除 / 重分配副本会触发 **staged change**，应用时**不触发完整 redeploy**：新副本复用现有镜像，被移除的副本优雅 drain（[Scaling](https://docs.railway.com/deployments/scaling)）。
- 多区域副本时，公共流量先路由到最近区域，再在区域内随机分发；单区域内多副本则区域内随机分发（[Scaling](https://docs.railway.com/deployments/scaling)）。

各计划上限（含副本数相乘后的总量）：

| 计划 | Replicas | RAM | CPU | 临时存储 | 卷存储 | 镜像大小 |
| --- | --- | --- | --- | --- | --- | --- |
| Trial | 2 | 1 GB | 2 vCPU | 1 GB | 0.5 GB | 4 GB |
| Free | 1 | 0.5 GB | 1 vCPU | 1 GB | 0.5 GB | 4 GB |
| Hobby | 6 | 48 GB | 48 vCPU | 100 GB | 5 GB | 100 GB |
| Pro | 42 | 1 TB | 1,000 vCPU | 100 GB | 1 TB | Unlimited |

来源：[Plans](https://docs.railway.com/pricing/plans)。

### 5.2 部署切换与重启策略

| 项 | 事实 | 出处 |
| --- | --- | --- |
| 切换方式 | 新部署拿到 2xx 后切 active、旧部署转 inactive（不是原地重启） | [Healthchecks](https://docs.railway.com/deployments/healthchecks) |
| 新旧重叠 | `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS` / `deploy.overlapSeconds`，**默认 0** | [变量参考](https://docs.railway.com/variables/reference)、[Config as Code](https://docs.railway.com/config-as-code/reference) |
| 优雅退出 | `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` / `deploy.drainingSeconds` 是 SIGTERM→SIGKILL 的缓冲，**默认 0** | 同上 |
| 重启策略 | `deploy.restartPolicyType`: `ON_FAILURE` / `ALWAYS` / `NEVER`，配 `restartPolicyMaxRetries` | [Config as Code](https://docs.railway.com/config-as-code/reference) |

### 5.3 内存态

- 进程重启 / 重新部署 = 容器重建，**进程内存里的东西全部丢失**，官方文档没有任何把内存态跨部署保留的机制；能跨部署保留的只有卷里的文件（[Volumes](https://docs.railway.com/volumes)）。
- 卷的行为约束（对"用卷存房间状态"这种想法很关键）：

| 约束 | 事实 | 出处 |
| --- | --- | --- |
| 挂载时机 | **容器启动时挂载，构建期不挂**；构建期写进该目录的数据不会持久化 | [Volumes](https://docs.railway.com/volumes) |
| pre-deploy 阶段 | 不挂卷，读写卷必须放进 start command | 同上 |
| 相对路径陷阱 | 应用文件在 `/app`，写 `./data` 就要挂到 `/app/data` | 同上 |
| 权限 | 卷以 `root` 挂载，跑非 root 镜像要设 `RAILWAY_RUN_UID=0` | 同上 |
| 区域 | 卷跟随 service 所在区域，换区域要迁移并停机 | [Regions](https://docs.railway.com/deployments/regions) |
| 与多副本的关系 | 官方**未明文禁止**给挂卷服务调多副本；但 healthchecks 页明确「两个部署不能同时 active 并挂同一卷」，即同一时刻只有一个 active 部署能独占该卷 | [Healthchecks](https://docs.railway.com/deployments/healthchecks) |

---

## 6. 计费与是否停机

| 计划 | 价格 | 附带资源额度 | 出处 |
| --- | --- | --- | --- |
| Free | $0 / 月 | **$1 / 月** free credit，**不跨月结转** | [Plans](https://docs.railway.com/pricing/plans)、[Free Trial](https://docs.railway.com/pricing/free-trial) |
| Hobby | **$5 / 月** | 含 **$5** 资源用量，超出按量补差 | [Plans](https://docs.railway.com/pricing/plans) |
| Pro | $20 / 月 | 含 $20 资源用量 | 同上 |
| Enterprise | 定制 | — | 同上 |

- 新账号 **Free Trial：一次性 $5，最长 30 天**；30 天到期或 $5 花完，自动降为 Free 计划（$1/月）（[Free Trial](https://docs.railway.com/pricing/free-trial)）。
- Trial 资源上限：1 GB RAM、共享（非独占）vCPU、每项目最多 5 个 service（[Free Trial](https://docs.railway.com/pricing/free-trial)）。
- 按量单价：RAM $10/GB/月、CPU $20/vCPU/月、出网 $0.05/GB、卷存储 $0.15/GB/月；**构建免费**，不收 build CPU / 内存 / 镜像存储（[Plans](https://docs.railway.com/pricing/plans)）。
- 额度用尽的行为：若用 credit 付款且余额归零，**订阅被取消、不能再部署、所有 workload 被停止**（"we will stop all of your workloads"）（[Plans FAQ](https://docs.railway.com/pricing/plans)）。
- 卷数据保留期：Free / Trial 到期后 30 天、Hobby 取消后 60 天、Pro 取消后 90 天删除（[Plans FAQ](https://docs.railway.com/pricing/plans)）。
- **空闲自动休眠 / 停止：未找到官方依据**。逐页查过 Plans、Free Trial、Scaling、Volumes、变量参考，没有任何"空闲 N 分钟后暂停/休眠"的机制说明；官方能确证的只有"余额归零则停掉全部 workload"这一条（[Plans FAQ](https://docs.railway.com/pricing/plans)）。

---

## 7. 区域

| 名称 | 位置 | region 标识 |
| --- | --- | --- |
| US West Metal | California, USA | `us-west2` |
| US East Metal | Virginia, USA | `us-east4-eqdc4a` |
| EU West Metal | Amsterdam, Netherlands | `europe-west4-drams3a` |
| **Southeast Asia Metal** | **Singapore** | **`asia-southeast1-eqsg3a`** |

来源：[Regions](https://docs.railway.com/deployments/regions)。

- 选择位置：**service settings 里的 region picker**；默认部署到账号的 preferred region（可在 Account Settings 改）（[Regions](https://docs.railway.com/deployments/regions)）。
- 换区域随时可做，域名与私有网络不变，**不挂卷时无 downtime**；挂卷则要迁移卷，迁移期间服务停机（[Regions](https://docs.railway.com/deployments/regions)）。
- 多区域副本可在 `deploy.multiRegionConfig` 里按区域写 `numReplicas`（[Config as Code](https://docs.railway.com/config-as-code/reference)）。
- 对中国大陆访问延迟：官方只说"All regions provide the same experience, performance, and reliability"，并按用户就近选区域建议（[Regions](https://docs.railway.com/deployments/regions)）。**具体到大陆的延迟数字未找到官方依据**，不要把估算写成事实。

---

## 8. 域名与 TLS

| 项 | 事实 | 出处 |
| --- | --- | --- |
| 默认域名 | `*.up.railway.app`，运行时可通过 `RAILWAY_PUBLIC_DOMAIN` 读取（示例形状 `example.up.railway.app`） | [变量参考](https://docs.railway.com/variables/reference)、[Public Networking](https://docs.railway.com/networking/public-networking) |
| 自定义域名 | 需要同时添加 **`CNAME` 与 `TXT` 两条 DNS 记录，两条都必需** | [Public Networking](https://docs.railway.com/networking/public-networking) |
| TLS | **自动**签发与续期，免费证书；支持 TLS 1.2 / 1.3 | [Public Networking](https://docs.railway.com/networking/public-networking)、[Edge 规格与限制](https://docs.railway.com/networking/public-networking/specs-and-limits) |
| 证书周期 | 有效期 90 天，剩余 30 天时续期；域名创建后最多尝试签发 72 小时，通常 1 小时内签出 | [Edge 规格与限制](https://docs.railway.com/networking/public-networking/specs-and-limits) |
| 边缘注入头 | `X-Real-IP`、`X-Forwarded-Proto`（恒为 https）、`X-Forwarded-Host`、`X-Railway-Edge`、`X-Request-Start`、`X-Railway-Request-Id` | 同上 |

---

## 9. 对下游票的输入

> 2026-11-06 已定案并落地：走仓根 Dockerfile（`docs/adr/0004-dockerfile-manual-deploy.md`），面板实际值为 `builder: DOCKERFILE`、`dockerfilePath: /Dockerfile`、`healthcheckPath: /health`、单副本、新加坡单区，Auto Deploy 关闭。下面保留的是立项时的候选写法与理由，**落点以 ADR 与 `docs/ops/railway-deploy.md` 为准**。

1. **构建方式**：本仓库无根 `package.json`，要在「Root Directory 指到 `apps/<server>`」与「写 Dockerfile」之间选一个；选 Dockerfile 时 `build.builder = "DOCKERFILE"`，start 默认取 `CMD`，不需再写 `startCommand`。
2. **Node 版本**：走 Railpack / Nixpacks 就用 `engines.node` 钉主版本（24 是 LTS）；走 Dockerfile 就用 `node:24-slim` 之类的基础镜像，二者不叠加。
3. **端口**：代码必须读 `process.env.PORT`，绑定地址按 `0.0.0.0` 写（文档只强制 `PORT`，`0.0.0.0` 是惯例）。
4. **健康检查**：给一个不依赖房间状态的端点返回 200，配 `deploy.healthcheckPath`；否则默认 300 秒判 failed 的规则不生效也不保护。落地端点定为 `/health`（`apps/server/src/server.mjs:932-935`，返回 `{ ok, rooms, uptime }`），而不是这一条当初写的 `/healthz`。
5. **单副本**：WebSocket + 内存态 + 官方不支持 sticky session ⇒ replicas 固定 1；扩副本等于主动制造房间分裂。
6. **不要用卷存房间状态**：卷只在启动时挂载、跟着区域走、且会阻断零停机部署；房间里的一切重启即丢，需要恢复就得自己写快照。
7. **区域**：`asia-southeast1-eqsg3a`（新加坡）是现成选项，在 service settings 选。

---

## 10. 未决与必须实测

- **监听 `0.0.0.0` 的官方明文**：未找到。要么补一次官方 RFC/文档核对，要么按容器惯例执行并在真机验证。
- **空闲是否会被休眠**：未找到官方依据。需要一个跑满 24h 的实测（看首次请求的冷启动耗时与计费曲线）才能定论。
- **挂卷 + 多副本是否被平台直接拒绝**：未找到明文，只有「不能同时 active 挂同一卷」的间接约束；若将来要上卷，需实测。
- **健康检查端点选择**：已落定为 `/health`。它带 `rooms` 计数但恒返 200——不能把「房间数为 0」判成失败，否则重启清房之后新部署永远过不了健康检查。
- **WebSocket 在 10,000 并发连接上限内的实际压测曲线**：官方只给上限，没给延迟分布。

---

## 11. 来源

- Builds: https://docs.railway.com/builds
- Railpack: https://docs.railway.com/builds/railpack
- Build Configuration: https://docs.railway.com/builds/build-configuration
- Build and Start Commands: https://docs.railway.com/builds/build-and-start-commands
- Config as Code Reference: https://docs.railway.com/config-as-code/reference
- Monorepo: https://docs.railway.com/deployments/monorepo
- Healthchecks: https://docs.railway.com/deployments/healthchecks
- Scaling: https://docs.railway.com/deployments/scaling
- Regions: https://docs.railway.com/deployments/regions
- Public Networking: https://docs.railway.com/networking/public-networking
- Edge Specs and Limits: https://docs.railway.com/networking/public-networking/specs-and-limits
- Variables Reference: https://docs.railway.com/variables/reference
- Volumes: https://docs.railway.com/volumes
- Pricing Plans: https://docs.railway.com/pricing/plans
- Free Trial: https://docs.railway.com/pricing/free-trial
- Railpack Node: https://railpack.com/languages/node
- Nixpacks Node Provider (docs): https://nixpacks.com/docs/providers/node
- Nixpacks Node Provider (source): https://github.com/railwayapp/nixpacks/blob/main/src/providers/node/mod.rs
- Node.js Releases: https://nodejs.org/en/about/previous-releases
