# Context Handoff · 上下文交接

> 把当前会话导出成可移植的交接文件，新会话读一下就接着干 —— 相当于「从对话里分支出去」。

![类型](https://img.shields.io/badge/type-WorkBuddy%20Skill-blue) ![依赖](https://img.shields.io/badge/deps-zero%20(Node%2018%2B)-green) ![License](https://img.shields.io/badge/license-MIT-lightgrey)

## 它解决什么问题

长会话上下文快满了，想换一个新窗口继续，又不想把前面做过的事再讲一遍。

ChatGPT 有「从消息分支出新会话」，WorkBuddy 目前没有。这个技能用**磁盘文件**实现等价效果：把当前会话的完整时间线、工具调用、项目状态导出成文件，新会话读取后即可无缝继续。文件可跨会话、跨设备，也能进版本库。

## 原理

WorkBuddy 会把每个会话记录在本地：

```
~/.workbuddy/projects/<项目slug>/<会话id>.jsonl
```

每行是一个事件，主要有三类：

| 类型 | 含义 |
| --- | --- |
| `message` | 一条对话消息（`role` 为 user / assistant，正文在 `content` 数组里） |
| `function_call` | 一次工具调用（`name` + `arguments`） |
| `function_call_result` | 工具返回结果 |

本技能的脚本逐行解析这些事件，还原成人类可读的时间线，并附加项目的 git 状态与文件清单。

> 所有处理都在**本机完成**，不联网、不上传任何内容。

## 安装

环境要求：**Node.js 18+**，无第三方依赖，不需要 `npm install`。

**方式一：git clone（推荐，方便 `git pull` 更新）**

```bash
git clone https://github.com/SeekAfterSeek/context-handoff-skill.git ~/.workbuddy/skills/context-handoff
```

Windows PowerShell：

```powershell
git clone https://github.com/SeekAfterSeek/context-handoff-skill.git "$env:USERPROFILE\.workbuddy\skills\context-handoff"
```

**方式二：下载解压**

把仓库内容放到 `<用户目录>/.workbuddy/skills/context-handoff/`，确保 `SKILL.md` 位于该目录第一层。

安装后**重启 WorkBuddy**（或新开一个任务），技能即会出现在技能列表中。

## 使用

在 WorkBuddy 里直接说触发词即可：

- 「上下文快满了，帮我分支出去」
- 「导出上下文 / 交接一下」
- 新会话里：「读交接文件继续」

也可以手动执行：

```bash
SKILL=~/.workbuddy/skills/context-handoff

node $SKILL/scripts/handoff.js export                  # 导出当前项目最新会话
node $SKILL/scripts/handoff.js export --project <目录>  # 指定项目
node $SKILL/scripts/handoff.js export --out <目录>      # 指定输出位置
node $SKILL/scripts/handoff.js export --session <id>    # 指定会话
node $SKILL/scripts/handoff.js export --brief-limit 600 # assistant 单条截断字数
node $SKILL/scripts/handoff.js list                     # 列出已有交接包
```

导出结果默认落在 **`<当前项目>/.workbuddy/handoff/`**。

## 产出什么

| 文件 | 内容 | 何时读 |
| --- | --- | --- |
| `handoff-<ts>.md` | 主交接：5 段摘要骨架 + git/文件状态 | 恢复时**必读** |
| `handoff-<ts>.brief.md` | 压缩对话（user 全文 / assistant 截断 / 工具调用名与参数摘要） | 需要回忆细节时 |
| `handoff-<ts>.full.md` | 完整对话原文 | 仅按需 grep |
| `handoff-<ts>.state.json` | cwd、git 分支、顶层文件、时间范围 | 程序化消费 |

主文件里的 5 段摘要（任务目标 / 关键决策 / 已完成 / 待办 / 卡点）由 AI 在导出后**写实**，这是能真正接上上下文的关键。

样例见 [`examples/sample-handoff.md`](examples/sample-handoff.md)。

## 边界

1. **不是模型记忆的复制**：靠显式记录延续，没写进摘要的细节不会自动保留。
2. **新会话要选同一工作目录**，否则默认找不到 `.workbuddy/handoff/`；可用 `--out` 指定固定位置规避。
3. `.full.md` 可能数 MB，**不要整篇读入上下文**，用 grep 定位。
4. 导出**不修改**原会话，旧会话照常可用——本质是复制一份状态。
5. 技能元数据在会话启动时加载，装好后需重启 WorkBuddy 才在技能列表可见。

## License

[MIT](LICENSE)
