---
name: context-handoff
version: "1.1.0"
display_name: 上下文交接（会话分支）
display_name_en: Context Handoff
description: Use when the conversation context is filling up and the user wants to branch the current session into a new one that continues from the same context. Triggers include "分支会话", "分支出去", "导出上下文", "上下文交接", "handoff", "把上下文带过去", "新会话接着做", "上下文快满了", "开个新窗口继续". Exports the current WorkBuddy session (local jsonl transcript plus project and git state) into portable handoff files under <cwd>/.workbuddy/handoff/, and restores progress in a new session by reading them.
description_zh: 把当前会话的上下文导出成可移植的交接文件，新会话读取后即可接着做，效果接近「从对话分支出去」。完整保留对话、工具调用与项目 git 状态，并生成待补写的摘要骨架。
description_en: Exports the current WorkBuddy session (messages, tool calls, project and git state) into portable handoff files so a new session can pick up exactly where the last one left off — a manual equivalent of branching a chat.
trigger_keywords: [分支会话, 分支出去, 导出上下文, 上下文交接, 交接一下, handoff, 上下文快满了, 新会话接着做, 开个新窗口继续, 把上下文带过去, 会话迁移, branch session, export context]
agent_created: true
---

# Context Handoff（会话交接 / 分支上下文）

把当前会话的上下文沉淀成**可移植的交接文件**，让新会话读取后接着做。效果接近「从当前对话分支出去」，区别是分支内容以磁盘文件承载，可跨会话、跨设备、可纳入版本管理。

## 何时使用

- 用户说「上下文快满了」「分支出去」「导出上下文」「交接一下」「开个新窗口接着做」
- 准备结束长会话，但不想丢进度
- 需要把任务移交给另一个会话或另一个人

## 前提认知（须向用户说明）

- 新会话**不会自动继承**对话记忆；本技能靠**显式记录**实现延续。
- 未写进交接文件的细节不会保留，因此「摘要区块」必须写全，不能敷衍。
- 交接文件默认落在 `<cwd>/.workbuddy/handoff/`，新会话需选**同一工作目录**才能找到。

## 流程 A：导出（分支出去）

1. 在项目根目录运行导出脚本（自动定位当前项目最新的会话 jsonl）：

   ```bash
   node <skill-dir>/scripts/handoff.js export
   ```

   可选参数：`--project <dir>`（目标项目）、`--out <dir>`（输出目录）、`--session <id>`（指定会话）、`--brief-limit 600`（assistant 单条截断字数）。

2. 读取脚本输出的 `HANDOFF_BRIEF`（`.brief.md`），快速回顾对话要点。

3. 打开 `HANDOFF_MAIN`（`.md`），把 5 个「待补充」区块**逐条写实**：
   - 任务目标：1–3 句话说清要达成什么；
   - 关键决策：已定的技术/方案选择及原因；
   - 已完成：具体文件路径、改动、commit；
   - 待办/下一步：按顺序、写成可直接执行的命令；
   - 卡点/坑点：失败现象、已排除的方向、注意事项。

4. **把开场白直接写入系统剪贴板**，省掉用户复制这一步（Windows 用 PowerShell `Set-Clipboard`，macOS 用 `pbcopy`）：

   ```text
   请阅读交接文件并接着做：<handoff-xxx.md>
   （摘要区块若为空，请先读同目录 .brief.md 自行补全并复述）
   ```

5. 向用户回报交接文件路径，并给出**最省操作**的恢复路径（WorkBuddy 侧无法程序化建任务，必须用户点两下）：

   - 左侧**把鼠标悬停到该项目所在的空间分组**上 → 点右侧「**新建任务**」（会自动带上该工作空间，不必手动选目录）；
   - 输入框 `Ctrl+V` 粘贴（剪贴板已就绪）→ 回车。

   > 不要建议用户手动「选择工作空间」，悬停分组新建更省事且不会选错。

## 流程 B：在新会话恢复

1. 定位交接文件（默认 `<cwd>/.workbuddy/handoff/`，取最新 `handoff-*.md`；也可用 `list` 查看）：

   ```bash
   node <skill-dir>/scripts/handoff.js list
   ```

2. 读取该 `.md` 文件。

3. 信息不足时再读同目录 `.brief.md`；只有需要原始细节时才 grep 或读 `.full.md`（可能数 MB，禁止整篇读入）。

4. 先向用户复述「上次做到哪、下一步是什么」，确认后再继续执行。

## 输出文件结构

| 文件 | 用途 | 何时读 |
| --- | --- | --- |
| `handoff-<ts>.md` | 主交接：摘要骨架 + 客观状态 | 恢复时必读 |
| `handoff-<ts>.brief.md` | 压缩对话（user 全文 / assistant 截断 / 工具名） | 需要回忆时 |
| `handoff-<ts>.full.md` | 完整对话原文 | 仅按需检索 |
| `handoff-<ts>.state.json` | cwd、git、顶层文件、时间范围 | 程序化消费 |

## 注意事项

- **先判断用户到底要什么**：若只是「想要另一个窗口看同一个任务」，直接用内置的「在独立窗口中打开」（任务行 `⋯` / 右键），上下文完全共享，**不需要交接**。只有要「全新会话但保留进度」时才走本技能。
- **WorkBuddy 目前没有程序化的「新建任务并预填」入口**（已实测：`workbuddy://` 深链只有 chat/home/skills/connectors/experts/channels/automation/teams，无任务预填路由；无新建任务菜单快捷键；调试端口未开启），所以「一键分支」无法完全自动化，最少仍需用户在 UI 点「新建任务」+ `Ctrl+V`。不要反复尝试自动化点击 UI。
- 环境要求：**Node.js 18+**，零第三方依赖（仅用内置模块），无需 npm install。
- 依赖 WorkBuddy 本地会话记录（`~/.workbuddy/projects/<slug>/*.jsonl`）。若目录命名变化导致定位失败，用 `--session` 或 `--project` 指定。
- `.full.md` 可能是数 MB，**不要整篇读入上下文**，用 grep 定位。
- 交接文件建议保留在项目内，不要随手删除；项目有 git 时可考虑提交以便追溯。
- 导出不修改原会话，也不影响旧会话继续使用——它只是复制一份状态。
