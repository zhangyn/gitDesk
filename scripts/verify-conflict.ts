/**
 * 冲突解析 / 合成验证：用真实 git 制造冲突，把工作区里带标记的文件喂给
 * src/conflict/parse.ts，再断言「按决策合成出来的内容」是否精确等于预期。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  hasConflictMarkers,
  parseConflictFile,
  resolveConflict,
  undecidedCount,
  type Decision,
} from '../src/conflict/parse';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) pass += 1;
  else {
    fail += 1;
    failures.push(`${name}${detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
}

const dir = mkdtempSync(join(tmpdir(), 'gitdesk-conflict-'));
const BASE = ['-c', 'core.quotepath=false', '-c', 'color.ui=false'];

function git(args: string[], input?: string): string {
  return execFileSync('git', [...BASE, ...args], {
    cwd: dir,
    encoding: 'utf8',
    input,
    maxBuffer: 1 << 26,
  });
}

function tryGit(args: string[]) {
  try {
    return { code: 0, out: git(args) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const file = 'app.txt';
const base = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10'];
const oursSide = ['O1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'O9', 'L10'];
const theirsSide = ['T1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'T10'];

function setup(conflictStyle: 'merge' | 'diff3'): void {
  if (tryGit(['rev-parse', '--git-dir']).code !== 0) {
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.name', 'T']);
    git(['config', 'user.email', 't@example.com']);
    git(['config', 'commit.gpgsign', 'false']);
    git(['config', 'core.autocrlf', 'false']);
  }
  git(['config', 'merge.conflictStyle', conflictStyle]);
  // 清干净再重来（顺序很重要：先回到 main 才能删别的分支）
  tryGit(['merge', '--abort']);
  tryGit(['checkout', '-q', '-f', 'main']);
  tryGit(['reset', '--hard', '-q']);
  tryGit(['clean', '-fdq']);
  for (const b of ['ours-branch', 'theirs-branch']) tryGit(['branch', '-D', b]);

  writeFileSync(join(dir, file), `${base.join('\n')}\n`);
  git(['add', '-A']);
  git(['commit', '-q', '--allow-empty', '-m', 'base']);

  git(['checkout', '-q', '-b', 'ours-branch']);
  writeFileSync(join(dir, file), `${oursSide.join('\n')}\n`);
  git(['commit', '-q', '-am', 'ours change']);

  git(['checkout', '-q', 'main']);
  git(['checkout', '-q', '-b', 'theirs-branch']);
  writeFileSync(join(dir, file), `${theirsSide.join('\n')}\n`);
  git(['commit', '-q', '-am', 'theirs change']);

  git(['checkout', '-q', 'ours-branch']);
  const merge = tryGit(['merge', 'theirs-branch', '--no-edit']);
  check(`  合并 ${conflictStyle} 产生冲突`, merge.code !== 0, merge.out);
}

try {
  /* ============================== 默认 merge 风格 ============================== */
  console.log('\n[1] merge 风格冲突：解析块');
  setup('merge');

  const merged = readFileSync(join(dir, file), 'utf8');
  check('  工作区文件含冲突标记', hasConflictMarkers(merged));
  check('  含 <<<<<<< 标记', merged.includes('<<<<<<<'));
  check('  不含 ||||||| 基线段', !merged.includes('|||||||'));

  const parsed = parseConflictFile(merged);
  eq('  解析出 2 个冲突块', parsed.conflicts.length, 2);
  eq('  无解析警告', parsed.warnings, []);
  eq('  块 1 我方内容', parsed.conflicts[0].ours, ['O1']);
  eq('  块 1 对方内容', parsed.conflicts[0].theirs, ['T1']);
  eq('  块 2 我方内容', parsed.conflicts[1].ours, ['O9', 'L10']);
  eq('  块 2 对方内容', parsed.conflicts[1].theirs, ['L9', 'T10']);
  check('  merge 风格无 base', parsed.conflicts.every((c) => c.hasBase === false));

  // 三段 stage 都应该在
  const stages = ['1', '2', '3'].map((s) => tryGit(['show', `:${s}:${file}`]).code);
  eq('  git show :1/:2/:3 都存在', stages, [0, 0, 0]);
  const baseBlob = git(['show', `:1:${file}`]);
  eq('  :1 是共同祖先内容', baseBlob, `${base.join('\n')}\n`);

  /* ============================== 三种决策 ============================== */
  console.log('\n[2] 决策：全我方 / 全对方 / 两个都要');
  eq('  未拍板块数 = 2', undecidedCount(parsed, {}), 2);

  const allOurs: Record<number, Decision> = { 1: 'ours', 2: 'ours' };
  eq('  全我方 = ours 分支内容', resolveConflict(parsed, allOurs), `${oursSide.join('\n')}\n`);

  const allTheirs: Record<number, Decision> = { 1: 'theirs', 2: 'theirs' };
  eq('  全对方 = theirs 分支内容', resolveConflict(parsed, allTheirs), `${theirsSide.join('\n')}\n`);

  const mixed: Record<number, Decision> = { 1: 'ours', 2: 'theirs' };
  eq(
    '  混合决策结果正确',
    resolveConflict(parsed, mixed),
    `${['O1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'T10'].join('\n')}\n`,
  );

  const both: Record<number, Decision> = { 1: 'both', 2: 'ours' };
  eq('  both = 我方在前 + 对方在后', resolveConflict(parsed, both).split('\n').slice(0, 2), [
    'O1',
    'T1',
  ]);

  const bothReverse: Record<number, Decision> = { 1: 'both-reverse', 2: 'ours' };
  eq('  both-reverse = 对方在前', resolveConflict(parsed, bothReverse).split('\n').slice(0, 2), [
    'T1',
    'O1',
  ]);

  check('  合成结果里没有残留标记', !hasConflictMarkers(resolveConflict(parsed, mixed)));

  /* ============================== 写回并标记解决 ============================== */
  console.log('\n[3] 写回工作区 + git add 标记解决');
  writeFileSync(join(dir, file), resolveConflict(parsed, mixed));
  const statusAfterResolve = git(['status', '--porcelain=v2', '-z', '--branch']);
  check('  未 add 前仍是未合并状态', statusAfterResolve.includes('\0u ') || statusAfterResolve.includes('u UU'), statusAfterResolve.slice(0, 80));

  git(['add', '--', file]);
  const statusAfterAdd = git(['status', '--porcelain=v2', '-z', '--branch']);
  check('  add 后不再是 unmerged', !/^u /m.test(statusAfterAdd) && !statusAfterAdd.includes('\0u '));
  eq('  工作区内容 = 合成结果', readFileSync(join(dir, file), 'utf8'), resolveConflict(parsed, mixed));

  tryGit(['merge', '--abort']);
  check('  merge --abort 后回到干净状态', git(['status', '--porcelain']).trim() === '');

  /* ============================== diff3 风格（带 base） ============================== */
  console.log('\n[4] diff3 风格：带 ||||||| 基线段');
  setup('diff3');
  const diff3Text = readFileSync(join(dir, file), 'utf8');
  check('  含 ||||||| 基线段', diff3Text.includes('|||||||'));
  const p3 = parseConflictFile(diff3Text);
  eq('  解析出 2 个冲突块', p3.conflicts.length, 2);
  check('  块 1 标记为有 base', p3.conflicts[0].hasBase === true);
  eq('  块 1 base 内容', p3.conflicts[0].base, ['L1']);
  eq('  块 1 我方', p3.conflicts[0].ours, ['O1']);
  eq('  块 1 对方', p3.conflicts[0].theirs, ['T1']);
  eq(
    '  带 base 的合成结果仍然正确',
    resolveConflict(p3, { 1: 'theirs', 2: 'ours' }),
    `${['T1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'O9', 'L10'].join('\n')}\n`,
  );

  /* ============================== 边界情况 ============================== */
  console.log('\n[5] 边界情况');
  const noConflict = 'just\nnormal\ntext\n';
  const p0 = parseConflictFile(noConflict);
  eq('  无冲突文件 → 0 个块', p0.conflicts.length, 0);
  eq('  无冲突文件合成后原样返回', resolveConflict(p0, {}), noConflict);

  // 正文里的 ======= 不应该被当成分隔符（Markdown 分隔线）
  const md = '# 标题\n=======\n正文\n';
  const pm = parseConflictFile(md);
  eq('  单独一行 ======= 不误判', pm.conflicts.length, 0);
  check('  单独一行 ======= 内容保留', resolveConflict(pm, {}).includes('======='));

  // 没有尾换行
  const noNl = 'a\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> b';
  const pn = parseConflictFile(noNl);
  eq('  无尾换行也能解析', pn.conflicts.length, 1);
  eq('  无尾换行合成后无尾换行', resolveConflict(pn, { 1: 'theirs' }), 'a\ny');

  // 空的一侧（删除全部内容）
  const emptySide = '<<<<<<< HEAD\n=======\nkept\n>>>>>>> b\n';
  const pe = parseConflictFile(emptySide);
  eq('  空我方解析成功', pe.conflicts[0].ours, []);
  eq('  空我方 + 采用我方 = 空文件', resolveConflict(pe, { 1: 'ours' }), '\n');
} catch (e) {
  fail += 1;
  failures.push(`脚本异常：${e instanceof Error ? e.message : String(e)}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const total = pass + fail;
console.log(`\n冲突解析验证：${pass}/${total} 通过`);
if (fail > 0) {
  console.log('\n失败项：');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('全部通过 ✓');
}
