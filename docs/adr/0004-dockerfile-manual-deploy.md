# 用仓根 Dockerfile 构建、手动触发发布

托管用**仓根 `Dockerfile`**，不用 Railway 默认构建器的自动探测；发布**手动触发**，不开"push 即上线"。

两条理由都是仓库形状决定的。其一，根目录没有 `package.json`，Railway 现在的默认构建器（Railpack）在这个仓上探不到 Node，而 Root Directory 又不能收窄到 `apps/server`——`ROOT = resolve(__dirname, "../../..")`（`apps/server/src/server.mjs:27`）要求进程从仓根读 `apps/web` 与 `assets`。Dockerfile 里显式钉 `node:24-slim`（README 要求 Node 24+，且 `packages/rules` 的测试直接跑 `.ts`）、`npm ci --prefix apps/server --omit=dev`、`CMD ["node", "apps/server/src/server.mjs"]`，把构建从平台启发式里摘出来；Railway 一旦在仓根检出 Dockerfile 必定用它，面板上因此显示 `builder: DOCKERFILE`、`dockerfilePath: /Dockerfile`。其二，房间数量与进程寿命强绑定（见 `docs/adr/0003-single-replica-ephemeral-rooms.md`），一次自动上线等于把所有进行中的对局打断，所以发布必须是人的动作。

服务侧一并固定：区域 Singapore `asia-southeast1-eqsg3a`，`deploy.healthcheckPath = /health`（`apps/server/src/server.mjs:932`），健康检查超时 300 秒，副本数 1。

**Considered Options**

- 加根 `package.json` 让 Railpack 自己装：少一个构建文件，但要引入 workspaces 或空壳包来骗过探测，且探测行为随平台版本演进；`apps/server` 之外的依赖一旦变化，失败点是黑箱。
- 只在 dashboard 填 build/start 命令：不进 code review，换项目或换环境就丢；命令本身还要处理 `$PORT` 的 shell 包装。
- 连 `release` 分支自动部署：多一条长期漂移的分支，且仍然挡不住"手滑 merge 进 release"。

**Consequences**

- 每次发布都要有人动手，并接受"点下去就是全员重连"。面板入口不在 Deployments 页的右上角（那里没有 `Deploy` 按钮），而是服务节点右键 `Latest deploy`，或任一行 `⋮` → `Redeploy`；三个动作的具体点击路径与验证步骤见 `docs/ops/railway-deploy.md`。
- Dockerfile 与其中的 Node 主版本成为唯一的运行时真相源：本仓既没有 `.nvmrc` / `.node-version`，`apps/server/package.json` 也没有 `engines`，本地按 README 的 Node 24+ 自备，平台侧只认 Dockerfile。
- `.dockerignore` 必须排除不需要进镜像的素材，否则构建上下文会被 88 MB 的仓库拖慢——`docs/rules` 的规则书 PDF 独占 38.6 MB，另有 `apps/web/.verify` 调试产物与 `node_modules`。
- 回滚靠 Railway 的历史部署重发上一个镜像，不靠 revert commit；这条路径与仓库历史无关，所以回滚不会把分支搞乱。
