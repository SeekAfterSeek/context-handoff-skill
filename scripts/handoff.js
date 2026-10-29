#!/usr/bin/env node
/**
 * context-handoff —— WorkBuddy 会话上下文导出工具
 *
 * 从本地会话 jsonl（~/.workbuddy/projects/<slug>/<session>.jsonl）提取时间线，
 * 生成可移植的交接文件包，供新会话读取后「接着上下文继续」。
 *
 * 会话 jsonl 的行类型（按 type 区分）：
 *   - message                role: user / assistant，content[].type: input_text / output_text / text
 *   - function_call          独立行，name + arguments(JSON 字符串)
 *   - function_call_result   独立行，name + output.text
 *   - reasoning / todo / plan / diff / file-history-snapshot / session-meta / ai-title  忽略
 *
 * 用法:
 *   node handoff.js export [--project <dir>] [--out <dir>] [--session <id>] [--brief-limit 600]
 *   node handoff.js list   [--project <dir>] [--out <dir>]
 *   node handoff.js help
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

// C:\Users\Lenovo\WorkBuddy\2026-10-28-06-50-06
//   → c-Users-Lenovo-WorkBuddy-2026-10-28-06-50-06
function projectSlug(cwd) {
  const normalized = cwd.replace(/\//g, '\\').replace(/\\+$/, '');
  const drive = normalized.slice(0, 1).toLowerCase();
  const rest = normalized.slice(2).replace(/\\/g, '-').replace(/:/g, '');
  return drive + rest;
}

function findSessionFile(projectDir, sessionId) {
  const root = path.join(os.homedir(), '.workbuddy', 'projects');
  if (!fs.existsSync(root)) return { dir: null, file: null, derivedExists: false };

  const candidates = [];
  const derived = path.join(root, projectSlug(projectDir));
  const derivedExists = fs.existsSync(derived) && fs.statSync(derived).isDirectory();
  if (derivedExists) candidates.push(derived);
  if (!candidates.length) {
    for (const d of fs.readdirSync(root)) {
      const full = path.join(root, d);
      try {
        if (fs.statSync(full).isDirectory()) candidates.push(full);
      } catch (_) {}
    }
  }

  let best = null;
  for (const dir of candidates) {
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    } catch (_) {
      continue;
    }
    for (const f of files) {
      if (sessionId && !f.includes(sessionId)) continue;
      const full = path.join(dir, f);
      let st;
      try {
        st = fs.statSync(full);
      } catch (_) {
        continue;
      }
      if (!best || st.mtimeMs > best.mtimeMs) best = { dir, file: full, mtimeMs: st.mtimeMs };
    }
  }
  return { dir: best ? best.dir : null, file: best ? best.file : null, derivedExists };
}

// 去掉注入的 system-reminder，优先取 <user_query> 内容
function cleanUserText(raw) {
  if (typeof raw !== 'string') return '';
  let t = raw.replace(/<system-reminder[\s\S]*?<\/system-reminder>/g, '');
  const m = t.match(/<user_query>([\s\S]*?)<\/user_query>/);
  if (m) return m[1].trim();
  return t.trim();
}

function truncate(s, n) {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function summarizeArgs(args) {
  if (args == null) return '';
  let s;
  if (typeof args === 'string') {
    // arguments 是 JSON 字符串，尽量压成单行
    try {
      s = JSON.stringify(JSON.parse(args));
    } catch (_) {
      s = args;
    }
  } else {
    try {
      s = JSON.stringify(args);
    } catch (_) {
      s = String(args);
    }
  }
  return truncate(s, 180);
}

// 判断是否为系统/后台通知（不属于用户真实发言，不纳入交接）
function isSystemNotice(text) {
  if (!text) return false;
  if (/^<task-notification>/.test(text)) return true;
  if (text.includes('[SYSTEM NOTIFICATION - NOT USER INPUT]')) return true;
  if (/^\[SYSTEM NOTIFICATION/.test(text)) return true;
  return false;
}

/**
 * 解析会话 jsonl 为时间线事件：
 *   { kind: 'user'|'assistant'|'tool'|'result', text?, name?, input?, output?, ts }
 */
function extractTimeline(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/);
  const events = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch (_) {
      continue; // 跳过不完整/非 JSON 行（会话可能正在写入）
    }
    const ts = o.timestamp || null;

    if (o.type === 'message' && (o.role === 'user' || o.role === 'assistant')) {
      let text = '';
      const content = o.content;
      if (typeof content === 'string') {
        text = o.role === 'user' ? cleanUserText(content) : content;
      } else if (Array.isArray(content)) {
        for (const c of content) {
          if (!c || typeof c !== 'object') continue;
          if (c.type === 'input_text' || c.type === 'output_text' || c.type === 'text') {
            const t = c.text || '';
            if (o.role === 'user') {
              const cleaned = cleanUserText(t);
              if (cleaned) text += (text ? '\n' : '') + cleaned;
            } else if (t) {
              text += t;
            }
          }
        }
      }
      text = text.trim();
      if (!text) continue;
      if (o.role === 'user' && isSystemNotice(text)) continue;
      events.push({ kind: o.role, text, ts });
    } else if (o.type === 'function_call') {
      events.push({
        kind: 'tool',
        name: o.name || 'tool',
        input: summarizeArgs(o.arguments),
        ts
      });
    } else if (o.type === 'function_call_result') {
      let out = '';
      if (o.output && typeof o.output === 'object') {
        out = o.output.text || '';
      } else if (typeof o.output === 'string') {
        out = o.output;
      }
      events.push({ kind: 'result', name: o.name || 'tool', output: truncate(out, 200), ts });
    }
    // 其余类型（reasoning / todo / plan / diff / session-meta / ai-title …）一律忽略
  }

  // 去重：① 相邻完全相同的事件；② 超长用户文本（>50 字）仅保留首次（应对会话重放/分叉）
  const seenLongUser = new Set();
  const deduped = [];
  for (const e of events) {
    if (e.kind === 'user' && e.text.length > 50) {
      if (seenLongUser.has(e.text)) continue;
      seenLongUser.add(e.text);
    }
    const prev = deduped[deduped.length - 1];
    if (prev) {
      const same =
        prev.kind === e.kind &&
        (prev.text || '') === (e.text || '') &&
        (prev.name || '') === (e.name || '') &&
        (prev.input || '') === (e.input || '') &&
        (prev.output || '') === (e.output || '');
      if (same) continue;
    }
    deduped.push(e);
  }
  return deduped;
}

function renderFull(events) {
  const blocks = [];
  let buf = [];
  const flush = () => {
    if (buf.length) {
      blocks.push(buf.join('\n'));
      buf = [];
    }
  };
  for (const e of events) {
    if (e.kind === 'user') {
      flush();
      blocks.push(`## 👤 User\n\n${e.text}`);
    } else if (e.kind === 'assistant') {
      flush();
      blocks.push(`## 🤖 Assistant\n\n${e.text}`);
    } else if (e.kind === 'tool') {
      buf.push(`- 🔧 \`${e.name}\` ${e.input}`);
    } else if (e.kind === 'result') {
      buf.push(`  - ↳ ${e.output || '(无输出)'}`);
    }
  }
  flush();
  return blocks.join('\n\n');
}

function renderBrief(events, limit) {
  const blocks = [];
  let buf = [];
  const flush = () => {
    if (buf.length) {
      blocks.push(buf.join('\n'));
      buf = [];
    }
  };
  for (const e of events) {
    if (e.kind === 'user') {
      flush();
      blocks.push(`### 👤 User\n\n${e.text}`);
    } else if (e.kind === 'assistant') {
      flush();
      let body = e.text;
      if (body.length > limit) body = body.slice(0, limit) + '…（已截断，完整见 .full.md）';
      blocks.push(`### 🤖 Assistant\n\n${body}`);
    } else if (e.kind === 'tool') {
      buf.push(`- 🔧 \`${e.name}\` ${e.input}`);
    } else if (e.kind === 'result') {
      buf.push(`  - ↳ ${truncate(e.output, 100) || '(无输出)'}`);
    }
  }
  flush();
  return blocks.join('\n\n');
}

function gitInfo(dir) {
  const run = (cmd) => {
    try {
      return execSync(cmd, {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 8000
      }).trim();
    } catch (_) {
      return '';
    }
  };
  return {
    branch: run('git rev-parse --abbrev-ref HEAD'),
    status: run('git status --short'),
    log: run('git log --oneline -5')
  };
}

function topLevelEntries(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => n !== 'node_modules' && n !== '.git')
      .slice(0, 40);
  } catch (_) {
    return [];
  }
}

function fmtTs(d) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function buildHandoffSkeleton(state, conv) {
  const last = conv
    .slice(-8)
    .map((m) => `- ${m.kind === 'user' ? '👤' : '🤖'} ${truncate(m.text, 160)}`)
    .join('\n');
  const files = state.topLevel.map((e) => `- \`${e}\``).join('\n') || '- （无）';

  return `# 会话交接（Handoff）

> 生成时间：${state.generatedAt}
> 项目目录：\`${state.projectDir}\`
> 会话 ID：\`${state.sessionId}\`
> 对话消息数：${state.messageCount}（另有工具调用 ${state.toolCount} 次）
> 时间范围：${state.timeRange.start} ~ ${state.timeRange.end}

## 1. 任务目标
<!-- 待补充：用 1-3 句话说明本次任务要达成什么 -->

## 2. 关键决策
<!-- 待补充：已确定的技术/方案选择，以及为什么这么选 -->

## 3. 已完成
<!-- 待补充：已交付的成果（文件路径、改动、提交） -->

## 4. 待办 / 下一步
<!-- 待补充：按顺序列出还没做的事，越具体越好（含可执行命令） -->

## 5. 当前卡点 / 坑点
<!-- 待补充：已知问题、失败原因、注意事项 -->

## 6. 重要文件与路径
${files}

## 7. Git 状态
当前分支：\`${state.git.branch || '（非 git 仓库）'}\`

\`\`\`
${state.git.status || '（无未提交变更）'}
\`\`\`

最近提交：
\`\`\`
${state.git.log || '（无）'}
\`\`\`

## 8. 最近对话摘录（自动提取，供快速回忆）
${last || '（无）'}

---

配套文件（同目录）：
- \`.brief.md\` —— 压缩对话（user 全文 + assistant 截断 + 工具调用）
- \`.full.md\` —— 完整对话原文（含全部工具调用与结果摘要）
- \`.state.json\` —— 结构化状态
`;
}

function cmdExport(args) {
  const projectDir = path.resolve(args.project || process.cwd());
  const found = findSessionFile(projectDir, args.session);
  if (!found.file) {
    console.error(
      '未找到会话记录。请用 --session <id> 指定，或确认 ' +
        path.join(os.homedir(), '.workbuddy', 'projects') +
        ' 下存在 jsonl。'
    );
    process.exit(2);
  }
  if (!found.derivedExists) {
    console.error('提示：未找到与当前目录精确匹配的项目记录，已回退到最近修改的会话。');
  }

  const events = extractTimeline(found.file);
  const conv = events.filter((e) => e.kind === 'user' || e.kind === 'assistant');
  if (!conv.length) {
    console.error('未解析到任何对话消息：' + found.file);
    process.exit(3);
  }
  const toolCount = events.filter((e) => e.kind === 'tool').length;

  const ts = fmtTs(new Date());
  const outDir = path.resolve(args.out || path.join(projectDir, '.workbuddy', 'handoff'));
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, `handoff-${ts}`);

  const sessionId = path.basename(found.file, '.jsonl');
  const times = events.map((e) => e.ts).filter((t) => typeof t === 'number');
  const t0 = times.length ? new Date(Math.min(...times)).toISOString() : '';
  const t1 = times.length ? new Date(Math.max(...times)).toISOString() : '';

  const state = {
    generatedAt: new Date().toISOString(),
    projectDir,
    sessionId,
    sessionFile: found.file,
    messageCount: conv.length,
    toolCount,
    timeRange: { start: t0, end: t1 },
    git: gitInfo(projectDir),
    topLevel: topLevelEntries(projectDir)
  };

  const briefLimit = parseInt(args['brief-limit'] || '600', 10) || 600;

  fs.writeFileSync(base + '.state.json', JSON.stringify(state, null, 2), 'utf8');
  fs.writeFileSync(base + '.full.md', renderFull(events), 'utf8');
  fs.writeFileSync(base + '.brief.md', renderBrief(events, briefLimit), 'utf8');
  fs.writeFileSync(base + '.md', buildHandoffSkeleton(state, conv), 'utf8');

  console.log('HANDOFF_MAIN=' + base + '.md');
  console.log('HANDOFF_BRIEF=' + base + '.brief.md');
  console.log('HANDOFF_FULL=' + base + '.full.md');
  console.log('HANDOFF_STATE=' + base + '.state.json');
  console.log('MESSAGE_COUNT=' + conv.length);
  console.log('TOOL_COUNT=' + toolCount);
  console.log('');
  console.log('--- 复制到新会话的开场白 ---');
  console.log(`请阅读交接文件并接着做：${base}.md`);
  console.log(`（如需细节，再读同目录的 ${path.basename(base)}.brief.md 或 .full.md）`);
}

function cmdList(args) {
  const projectDir = path.resolve(args.project || process.cwd());
  const outDir = path.resolve(args.out || path.join(projectDir, '.workbuddy', 'handoff'));
  if (!fs.existsSync(outDir)) {
    console.log('暂无交接记录：' + outDir);
    return;
  }
  const files = fs
    .readdirSync(outDir)
    .filter((f) => /^handoff-.*\.md$/.test(f) && !/\.(brief|full)\.md$/.test(f))
    .map((f) => {
      const full = path.join(outDir, f);
      return { f, mtimeMs: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!files.length) {
    console.log('暂无交接记录：' + outDir);
    return;
  }
  console.log('交接记录（新→旧）：');
  for (const it of files) {
    console.log(`- ${it.f}  (${new Date(it.mtimeMs).toLocaleString()})`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'help';
  if (cmd === 'export') return cmdExport(args);
  if (cmd === 'list') return cmdList(args);
  console.log(`context-handoff 用法:
  node handoff.js export [--project <dir>] [--out <dir>] [--session <id>] [--brief-limit 600]
  node handoff.js list   [--project <dir>] [--out <dir>]
  node handoff.js help`);
}

main();
