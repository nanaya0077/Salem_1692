# 本地 Markdown 追踪器（临时）

`deck_` 工具绑定的 GitHub 后端在本工作区不可用：目录不是 git 仓库，也没有 `owner/name`，`deck_issue_list` 返回 `repo.refId missing or malformed`。按 wayfinder 的默认回退，地图与子票落在本地 Markdown。

## 约定

- `MAP.md`：地图，`label: wayfinder:map`。
- `tickets/wNN-*.md`：子票；front matter 的 `type` 即 `wayfinder:<type>`，`parent` 是父子边，`blockedBy` 是阻塞边，`status` 是开关状态。
- 关闭：`status: closed`，追加 `## Answer`；同时在 `MAP.md` 的 Decisions so far 加一行。
- 认领：front matter `assignee` 填当前会话；未填即未认领。
- 查询 frontier：`status: open` 且 `blockedBy` 里每个 id 都已 closed。先用 `rg` 人工核对，后续可写脚本。
- 资产与原型链接写在票的 `## Assets`，不贴进正文。

## 迁移

`deck_context` 恢复可用后，按 front matter 逐张 `deck_issue_create`（map 先建，子票带 parentKey/blockedBy），再把本地 `status/answer` 回填。
