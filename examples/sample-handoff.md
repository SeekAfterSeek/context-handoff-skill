# 会话交接（Handoff）

> 生成时间：2026-10-29T05:49:27.877Z
> 项目目录：`C:\Users\you\WorkBuddy\demo-project`
> 会话 ID：`0f6d1c2e-demo-4a7b-9c11-2b8ae0f31a44`
> 对话消息数：42（另有工具调用 67 次）
> 时间范围：2026-10-28T02:10:05.112Z ~ 2026-10-29T05:49:23.598Z

> 这是一份**示例**交接文件，用于说明导出产物长什么样（项目名、路径、会话 ID 均为虚构）。
> 段落 1–5 由 AI 在导出后补写，6–8 由脚本自动生成。

## 1. 任务目标

给内部数据看板加一个「按周聚合」的口径切换：用户可在同一页面切换「按天 / 按周」查看订单量与转化率，默认按天。

## 2. 关键决策

- 聚合在前端做（数据量 < 5 万行），避免改动后端接口。
- 周起始定为周一（符合国内业务习惯），不采用 ISO 周的周日。
- 口径切换状态存 URL query（`?grain=week`），便于分享与刷新保持。
- 图表库沿用现有 ECharts，不引入新依赖。

## 3. 已完成

- `src/pages/Dashboard.tsx`：新增 grain 切换控件，默认 `day`。
- `src/lib/aggregate.ts`：新增 `groupByWeek()`，含周一为起点的边界处理。
- `src/lib/aggregate.test.ts`：补 6 条单测（跨年周、单日周、空数据）。
- `docs/spec-grain.md`：口径说明文档。
- commit：`a1b2c3d feat(dashboard): 支持按周聚合`（已 push 到 `origin/main`）。

## 4. 待办 / 下一步

1. 跑单测确认全绿：
   ```bash
   npm test -- aggregate
   ```
2. 补「按周」的转化率分母口径（当前分子已按周，分母仍按天求和，需统一）。
3. 给切换控件补一个 E2E：`?grain=week` 直达时控件状态正确。
4. 更新 `CHANGELOG.md` 并发布 `v1.4.0`。

## 5. 当前卡点 / 坑点

- 跨年周（12/29–1/4）分组时，`getWeekStart()` 在时区为 UTC+8 下会偏一天；已用「本地时间构造 + 手动归零时分秒」绕过，但**尚未写进单测**，属于潜在回归点。
- 分母口径未统一，若直接上线会导致按周转化率虚高约 1/7。
- 后端接口 `GET /orders` 最多返回 30 天，按周视图跨月时需要两次请求合并，目前未处理。

## 6. 重要文件与路径

- `src/pages/Dashboard.tsx`
- `src/lib/aggregate.ts`
- `src/lib/aggregate.test.ts`
- `docs/spec-grain.md`

## 7. Git 状态

- 分支：`main`（与 `origin/main` 同步）
- 最近提交：`a1b2c3d feat(dashboard): 支持按周聚合`
- 未提交改动：`src/lib/aggregate.test.ts`（新增 2 条用例，未 commit）

## 8. 最近对话摘录（自动提取，供快速回忆）

- **User**：按周聚合的边界，跨年那周你打算怎么算？
- **Assistant**：以周一为起点，跨年周会归到「包含周四的那一年的第 1 周」……
- **User**：分母也要按周，别混着算。
- **Assistant**：明白，分母需要同步聚合，我列进待办第 2 条。
