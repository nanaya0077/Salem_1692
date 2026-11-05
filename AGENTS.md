# AGENTS.md

《女巫镇》在线版 —— 一个基于同名桌游规则的实时多人 Web 游戏仓库。

- 领域词以 `GLOSSARY.md` 为准，写票、提方案、起测试名都用里面的词，不要自造同义词。
- 规则原文（PDF 与抽取文本）在 `docs/rules/`，是素材，不是规范来源。
- 远端 `origin` 指向 `nanaya0077/Salem_1692`（默认分支 `main`），issue 与规格落在 GitHub issues（见下方 Issue tracker）。

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues on `nanaya0077/Salem_1692`; use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles, label strings unchanged (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` at the root plus `docs/adr/`. See `docs/agents/domain.md`.
