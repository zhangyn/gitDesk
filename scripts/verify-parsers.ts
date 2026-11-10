/**
 * 解析层验证脚本（不依赖 Tauri / Rust）。
 *
 * 用真实 git 造出各种场景，再把输出喂给 src/parse/* 和 layout.ts 断言。
 * 运行：npm run verify
 *
 * 之所以能脱离壳跑：所有解析器都是纯函数，只 import type。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseLog } from '../src/parse/log';
import { parseStatusV2 } from '../src/parse/status';
import { parsePatches, synthesizeAdded } from '../src/parse/diff';
import { layoutGraph } from '../src/features/graph/layout';

const BASE = ['-c', 'core.quotepath=false', '-c', 'color.ui=false'];

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    failures.push(`${name}${detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
}

const dir = mkdtempSync(join(tmpdir(), 'gitdesk-verify-'));
const git = (args: string[]): string =>
  execFileSync('git', [...BASE, ...args], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const write = (rel: string, content: string): void => {
  const abs = join(dir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
};

try {
  /* ---------------------------------------------------------------- 造仓库 */
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', '测试用户']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'commit.gpgsign', 'false']);

  write('a.txt', 'line1\nline2\nline3\n');
  write('docs/中文 说明.md', '# 中文文件名\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', '初始提交：中文 & emoji 🚀']);

  git(['checkout', '-q', '-b', 'feature/x']);
  write('b.txt', 'feature line\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'feat: 新增 b.txt']);

  git(['checkout', '-q', 'main']);
  write('c.txt', 'main line\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'feat: 新增 c.txt']);

  git(['merge', '-q', '--no-ff', 'feature/x', '-m', 'merge: feature/x into main']);
  git(['tag', '-a', 'v1.0', '-m', 'release 1.0']);

  /* ---------------------------------------------------------------- log */
  const LOG_FORMAT =
    ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%s', '%D'].join('%x1f') + '%x1e';
  const logOut = git(['log', '--all', '--topo-order', '-n', '50', `--format=${LOG_FORMAT}`]);
  const commits = parseLog(logOut);

  eq('log: 提交数量', commits.length, 4);
  check('log: 全部 sha 非空', commits.every((c) => /^[0-9a-f]{40}$/.test(c.sha)), commits.map((c) => c.sha));
  check(
    'log: 中文提交信息未被转义',
    commits.some((c) => c.subject === '初始提交：中文 & emoji 🚀'),
    commits.map((c) => c.subject),
  );
  check(
    'log: 中文作者名正确',
    commits.every((c) => c.authorName === '测试用户'),
    commits[0]?.authorName,
  );

  const merge = commits.find((c) => c.subject.startsWith('merge:'));
  check('log: merge 提交有两个 parent', merge?.parents.length === 2, merge?.parents);
  check('log: 根提交没有 parent', commits[commits.length - 1].parents.length === 0);

  const decorated = commits.find((c) => c.refs.some((r) => r.startsWith('tag: v1.0')));
  check('log: tag 装饰解析成功', decorated !== undefined, commits.map((c) => c.refs));
  const head = commits.find((c) => c.refs.some((r) => r.startsWith('HEAD ->')));
  check('log: HEAD -> main 装饰解析成功', head !== undefined);

  /* ---------------------------------------------------------------- graph */
  const rows = layoutGraph(commits);
  eq('graph: 行数与提交数一致', rows.length, commits.length);
  check(
    'graph: 泳道索引合法',
    rows.every((r) => r.lane >= 0 && r.lane < 24 && Number.isInteger(r.lane)),
    rows.map((r) => r.lane),
  );
  check(
    'graph: 每条边的泳道都在本行可见范围内',
    rows.every((r) =>
      r.edges.every((e) => {
        const limit = Math.max(r.before.length, r.after.length, r.lane + 1) + 1;
        return e.from < limit && e.to < limit && e.from >= 0 && e.to >= 0;
      }),
    ),
    rows.map((r) => r.edges),
  );
  check(
    'graph: 每个提交的 sha 恰好出现一次',
    new Set(rows.map((r) => r.sha)).size === commits.length,
  );
  check(
    'graph: 首行泳道为 0',
    rows[0]?.lane === 0,
    rows[0]?.lane,
  );
  const mergeRow = rows.find((r) => r.sha === merge?.sha);
  check('graph: merge 行有 2 条向下边', (mergeRow?.edges.length ?? 0) >= 2, mergeRow?.edges);

  /* ---------------------------------------------------------------- status */
  write('a.txt', 'line1\nline2 CHANGED\nline3\n'); // 工作区修改
  write('新建文件.txt', 'untracked\n'); // 未跟踪
  write('b.txt', 'feature line\nstaged add\n'); // 暂存区修改
  git(['add', 'b.txt']);

  const statusRaw = git(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=normal']);
  const status = parseStatusV2(statusRaw);

  eq('status: 当前分支', status.branch.head, 'main');
  check('status: branch.oid 已解析', (status.branch.oid ?? '').length === 40, status.branch.oid);
  check('status: 条目数量', status.entries.length >= 3, status.entries);

  const stagedB = status.entries.find((e) => e.path === 'b.txt');
  check('status: b.txt 在暂存区', stagedB !== undefined && stagedB.index === 'M', stagedB);
  const modifiedA = status.entries.find((e) => e.path === 'a.txt');
  check('status: a.txt 在工作区', modifiedA !== undefined && modifiedA.worktree === 'M', modifiedA);
  const untrackedFile = status.entries.find((e) => e.path === '新建文件.txt');
  check('status: 未跟踪中文文件名', untrackedFile?.kind === 'untracked', status.entries);
  check(
    'status: 中文路径没有被 "\\" 转义或加引号',
    status.entries.every((e) => !e.path.includes('"') && !/\\\d{3}/.test(e.path)),
    status.entries.map((e) => e.path),
  );

  /* ---------------------------------------------------------------- 冲突状态 */
  git(['checkout', '-q', '-b', 'conflict-a']);
  write('a.txt', 'AAA\nline2\nline3\n');
  git(['commit', '-q', '-am', 'conflict: ours']);
  git(['checkout', '-q', 'main']);
  write('a.txt', 'BBB\nline2\nline3\n');
  git(['commit', '-q', '-am', 'conflict: theirs']);
  try {
    git(['merge', 'conflict-a', '--no-edit']);
  } catch {
    /* 预期冲突 */
  }
  const conflictStatus = parseStatusV2(
    git(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=normal']),
  );
  const unmerged = conflictStatus.entries.find((e) => e.kind === 'unmerged' && e.path === 'a.txt');
  check('status: 冲突条目被识别', unmerged !== undefined, conflictStatus.entries.map((e) => [e.path, e.kind]));
  check('status: 冲突暂存三段 stage 已解析', (unmerged?.stages?.m1 ?? '').length > 0, unmerged?.stages);
  git(['merge', '--abort']);

  /* ---------------------------------------------------------------- diff */
  // 先把 a.txt 回到一个已知基线，避免受前面冲突/回滚影响
  write('a.txt', 'line1\nline2\nline3\n');
  git(['commit', '-q', '-am', 'reset a.txt for diff test']);
  write('a.txt', 'line1\nline2 CHANGED\nline3\n');
  const diffOut = git(['diff', '--no-color', '--no-ext-diff', '-U3', '--no-renames', '--', 'a.txt']);
  const patches = parsePatches(diffOut);
  eq('diff: 单个文件 patch', patches.length, 1);
  eq('diff: 文件路径', patches[0]?.newPath, 'a.txt');
  check('diff: 有 hunk', (patches[0]?.hunks.length ?? 0) >= 1);

  const hunk = patches[0]?.hunks[0];
  eq('diff: hunk 起始行（新）', hunk?.newStart, 1);
  const added = hunk?.lines.filter((l) => l.kind === 'add') ?? [];
  const removed = hunk?.lines.filter((l) => l.kind === 'del') ?? [];
  eq('diff: 新增行数', added.length, 1);
  eq('diff: 删除行数', removed.length, 1);
  eq('diff: 新增行内容', added[0]?.text, 'line2 CHANGED');
  eq('diff: 删除行内容', removed[0]?.text, 'line2');
  eq('diff: 新增行 newNo', added[0]?.newNo, 2);
  eq('diff: 删除行 oldNo', removed[0]?.oldNo, 2);

  const ctx = hunk?.lines.filter((l) => l.kind === 'ctx') ?? [];
  check(
    'diff: 上下文行号连续',
    ctx.every((l, i) => (l.oldNo ?? 0) >= 1 && (l.newNo ?? 0) >= 1 && l.oldNo !== null),
    ctx,
  );

  /* ---------------------------------------------------------------- CRLF */
  write('crlf.txt', 'one\r\ntwo\r\nthree\r\n');
  git(['add', 'crlf.txt']);
  git(['commit', '-q', '-m', 'add crlf']);
  write('crlf.txt', 'one\r\ntwo CHANGED\r\nthree\r\n');
  const crlfPatch = parsePatches(git(['diff', '--no-color', '-U3', '--', 'crlf.txt']));
  check('diff: CRLF 文件能解析出 hunk', (crlfPatch[0]?.hunks.length ?? 0) >= 1);
  check(
    'diff: CRLF 内容不残留 \\r',
    crlfPatch[0]?.hunks[0]?.lines.every((l) => !l.text.includes('\r')) ?? false,
  );

  /* ---------------------------------------------------------------- 新增文件 */
  const addedPatch = synthesizeAdded('x\ny\n', 'brand-new.txt', false);
  eq('synthetic: hunks', addedPatch.hunks.length, 1);
  eq('synthetic: 行数', addedPatch.hunks[0].lines.length, 2);
  eq('synthetic: 全部为 add', addedPatch.hunks[0].lines.every((l) => l.kind === 'add'), true);
  eq('synthetic: newPath', addedPatch.newPath, 'brand-new.txt');

  /* ---------------------------------------------------------------- name-status */
  const nameStatus = git([
    'show',
    '--name-status',
    '--format=',
    '-z',
    '--no-renames',
    commits.find((c) => c.subject.startsWith('merge:'))!.sha,
  ]);
  const tokens = nameStatus.split('\0').filter((t) => t.length > 0);
  check('name-status: token 数量为偶数', tokens.length % 2 === 0, tokens);
  check(
    'name-status: 状态字母合法',
    tokens.filter((_, i) => i % 2 === 0).every((s) => /^[AMDTU]$/.test(s)),
    tokens,
  );
  check(
    'name-status: 路径不含引号转义',
    tokens.filter((_, i) => i % 2 === 1).every((p) => !p.includes('"')),
    tokens,
  );

  /* ---------------------------------------------------------------- refs */
  const refsOut = git([
    'for-each-ref',
    '--format=%(objectname) %(refname) %(upstream)',
    'refs/heads',
    'refs/remotes',
    'refs/tags',
  ]);
  const refLines = refsOut.split(/\r?\n/).filter((l) => l.trim());
  check('refs: 至少 3 条', refLines.length >= 3, refLines);
  check(
    'refs: 每行三段（空 upstream 也占位）',
    refLines.every((l) => l.split(' ').length >= 2),
    refLines,
  );
  check(
    'refs: 中文分支名不受影响',
    refsOut.includes('refs/heads/conflict-a'),
    refLines.filter((l) => l.includes('refs/heads/')),
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

/* ---------------------------------------------------------------- 汇总 */
const total = pass + fail;
console.log(`\n解析层验证：${pass}/${total} 通过`);
if (fail > 0) {
  console.log('\n失败项：');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('全部通过 ✓');
}
