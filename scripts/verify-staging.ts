/**
 * 行级 / hunk 级暂存的端到端验证。
 *
 * 用真实 git 跑完整链路：
 *   git diff → parsePatches → buildSelectedPatch → git apply --cached
 * 然后断言「index 里到底是什么内容」。
 *
 * 这是整个项目最容易写坏用户工作区的地方，所以断言只看两件事：
 *   1. 暂存后 index 的内容是否精确符合预期
 *   2. 没被选中的改动是否原样留在工作区
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { parsePatches } from '../src/parse/diff';
import { buildSelectedPatch, lineKey } from '../src/patch/build';
import type { DiffLine, FilePatch } from '../src/types';

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

const dir = mkdtempSync(join(tmpdir(), 'gitdesk-stage-'));
const BASE = ['-c', 'core.quotepath=false', '-c', 'color.ui=false'];

function git(args: string[], input?: string): string {
  return execFileSync('git', [...BASE, ...args], {
    cwd: dir,
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function tryGit(args: string[], input?: string): { code: number; out: string; err: string } {
  try {
    const out = git(args, input);
    return { code: 0, out, err: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, out: String(err.stdout ?? ''), err: String(err.stderr ?? '') };
  }
}

const write = (rel: string, content: string): void => {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
};

/** index 里的文件内容（不存在时抛错） */
function indexContent(rel: string): string {
  return git(['show', `:${rel}`]);
}

/** 工作区文件内容 */
function worktreeContent(rel: string): string {
  try {
    return readFileSync(join(dir, rel), 'utf8');
  } catch {
    return '';
  }
}

function diffOf(rel: string, cached = false): FilePatch[] {
  const args = ['diff', '--no-color', '--no-ext-diff', '-U3', '--no-renames'];
  if (cached) args.push('--cached');
  args.push('--', rel);
  return parsePatches(git(args));
}

/** 按谓词构造选择集；断言至少选中了 1 行 */
function selectWhere(
  patches: FilePatch[],
  pred: (line: DiffLine, ctx: { pi: number; hi: number; li: number; text: string }) => boolean,
): Set<string> {
  const sel = new Set<string>();
  patches.forEach((p, pi) =>
    p.hunks.forEach((h, hi) =>
      h.lines.forEach((l, li) => {
        if (pred(l, { pi, hi, li, text: l.text })) sel.add(lineKey(pi, hi, li));
      }),
    ),
  );
  check('  选择集非空', sel.size > 0, [...sel]);
  return sel;
}

function applyIndex(patchText: string, reverse = false): { code: number; err: string } {
  const args = ['apply', '--cached', '--recount', '--whitespace=nowarn'];
  if (reverse) args.push('-R');
  args.push('-');
  const r = tryGit(args, patchText);
  return { code: r.code, err: r.err || r.out };
}

try {
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'user.email', 't@example.com']);
  git(['config', 'commit.gpgsign', 'false']);
  // 关掉 autocrlf 干扰，本机全局可能开了 true
  git(['config', 'core.autocrlf', 'false']);

  /* ============================== 场景 1：多 hunk 只暂存一块 ============================== */
  console.log('\n[1] 多 hunk 文件：只暂存第 1 块');
  const l20 = Array.from({ length: 20 }, (_, i) => `L${i + 1}`);
  write('multi.txt', `${l20.join('\n')}\n`);
  git(['add', 'multi.txt']);
  git(['commit', '-q', '-m', 'base multi']);

  const m2 = [...l20];
  m2[1] = 'L2-mod';
  m2[17] = 'L18-mod';
  write('multi.txt', `${m2.join('\n')}\n`);

  let patches = diffOf('multi.txt');
  check('  解析出 2 个 hunk', patches[0]?.hunks.length === 2, patches[0]?.hunks.length);

  let sel = selectWhere(patches, (l) => l.text === 'L2-mod' || l.text === 'L2');
  let built = buildSelectedPatch(patches, sel);
  let applied = applyIndex(built.patch);
  eq('  git apply 成功', applied.code, 0);

  const staged1 = indexContent('multi.txt');
  check('  index 含 L2-mod', staged1.includes('L2-mod'), staged1.slice(0, 40));
  check('  index 不含 L18-mod', !staged1.includes('L18-mod'));
  check('  index 仍含 L18 原值', staged1.includes('L18'));
  check('  工作区仍是两份改动', worktreeContent('multi.txt').includes('L18-mod'));

  const stagedDiff = git(['diff', '--cached', '--name-only']);
  eq('  暂存区只有 multi.txt', stagedDiff.trim(), 'multi.txt');

  /* ============================== 场景 2：单 hunk 内选一行 ============================== */
  console.log('\n[2] 同一 hunk 内：只暂存 1 行新增');
  write('lines.txt', 'a\nb\nc\nd\ne\n');
  git(['add', 'lines.txt']);
  git(['commit', '-q', '-m', 'base lines']);

  write('lines.txt', 'a\nb\nX1\nX2\nX3\nc\nd\ne\n');
  patches = diffOf('lines.txt');
  eq('  只有 1 个 hunk', patches[0]?.hunks.length, 1);
  const addCount = patches[0]?.hunks[0].lines.filter((l) => l.kind === 'add').length;
  eq('  hunk 内有 3 行新增', addCount, 3);

  sel = selectWhere(patches, (l) => l.kind === 'add' && l.text === 'X2');
  built = buildSelectedPatch(patches, sel);
  eq('  选中行数 = 1', built.count, 1);
  applied = applyIndex(built.patch);
  eq('  git apply 成功', applied.code, 0);

  eq('  index 精确等于 a,b,X2,c,d,e', indexContent('lines.txt'), 'a\nb\nX2\nc\nd\ne\n');
  eq('  工作区未受影响', worktreeContent('lines.txt'), 'a\nb\nX1\nX2\nX3\nc\nd\ne\n');

  const remain = diffOf('lines.txt');
  const remainAdds = remain[0]?.hunks.flatMap((h) => h.lines.filter((l) => l.kind === 'add')) ?? [];
  eq(
    '  剩余未暂存新增行 = X1,X3',
    remainAdds.map((l) => l.text),
    ['X1', 'X3'],
  );

  /* ============================== 场景 3：反向 apply 取消暂存 ============================== */
  console.log('\n[3] 反向 apply：取消刚才的暂存');
  applied = applyIndex(built.patch, true);
  eq('  git apply -R 成功', applied.code, 0);
  eq('  index 回到 HEAD 内容', indexContent('lines.txt'), 'a\nb\nc\nd\ne\n');
  eq('  工作区仍是修改版', worktreeContent('lines.txt'), 'a\nb\nX1\nX2\nX3\nc\nd\ne\n');

  /* ============================== 场景 4：未选中的删除降级成上下文 ============================== */
  console.log('\n[4] 只暂存新增、不暂存删除 → 删除行必须降级为上下文');
  write('del.txt', 'p\nq\nr\n');
  git(['add', 'del.txt']);
  git(['commit', '-q', '-m', 'base del']);

  write('del.txt', 'p\nR\n');
  patches = diffOf('del.txt');
  const hasDel = patches[0]?.hunks[0].lines.some((l) => l.kind === 'del');
  check('  原始 hunk 含删除行', hasDel === true);

  sel = selectWhere(patches, (l) => l.kind === 'add' && l.text === 'R');
  built = buildSelectedPatch(patches, sel);
  applied = applyIndex(built.patch);
  eq('  git apply 成功', applied.code, 0);
  eq('  index = base + 追加 R（q、r 保留）', indexContent('del.txt'), 'p\nq\nr\nR\n');

  /* ============================== 场景 5：新文件部分暂存 ============================== */
  console.log('\n[5] 新文件：只暂存第一行');
  write('fresh.txt', 'first\nsecond\nthird\n');
  git(['add', 'fresh.txt']);
  const newFilePatches = diffOf('fresh.txt', true);
  eq('  识别为新文件', newFilePatches[0]?.isNew, true);
  const newSel = selectWhere(newFilePatches, (l) => l.kind === 'add' && l.text === 'first');
  const newBuilt = buildSelectedPatch(newFilePatches, newSel);

  git(['rm', '--cached', '-q', 'fresh.txt']);
  check('  取消暂存后不在 index', tryGit(['ls-files', '--error-unmatch', 'fresh.txt']).code !== 0);
  applied = applyIndex(newBuilt.patch);
  eq('  git apply 成功', applied.code, 0);
  eq('  index 只有第一行', indexContent('fresh.txt'), 'first\n');
  eq('  工作区仍是完整文件', worktreeContent('fresh.txt'), 'first\nsecond\nthird\n');

  /* ============================== 场景 6：删除文件 ============================== */
  console.log('\n[6] 删除文件：整块暂存');
  write('gone.txt', 'only line\n');
  git(['add', 'gone.txt']);
  git(['commit', '-q', '-m', 'add gone']);
  rmSync(join(dir, 'gone.txt'));

  patches = diffOf('gone.txt');
  eq('  识别为删除', patches[0]?.isDeleted, true);
  const delSel = new Set<string>();
  patches.forEach((p, pi) =>
    p.hunks.forEach((h, hi) =>
      h.lines.forEach((l, li) => {
        if (l.kind === 'del') delSel.add(lineKey(pi, hi, li));
      }),
    ),
  );
  const delBuilt = buildSelectedPatch(patches, delSel);
  applied = applyIndex(delBuilt.patch);
  eq('  git apply 成功', applied.code, 0);
  check('  index 中已删除', tryGit(['ls-files', '--error-unmatch', 'gone.txt']).code !== 0);

  /* ============================== 场景 7：文件末尾无换行 ============================== */
  console.log('\n[7] 文件末尾无换行（注意 \\ No newline 标记）');
  write('nonl.txt', 'alpha\nbeta');
  git(['add', 'nonl.txt']);
  git(['commit', '-q', '-m', 'add nonl']);

  write('nonl.txt', 'alpha\ngamma');
  patches = diffOf('nonl.txt');
  const hasMeta = patches[0]?.hunks[0].lines.some((l) => l.kind === 'meta');
  check('  解析到 \\ No newline 标记', hasMeta === true);

  sel = selectWhere(patches, (l) => l.kind === 'add' && l.text === 'gamma');
  built = buildSelectedPatch(patches, sel);
  applied = applyIndex(built.patch);
  eq('  git apply 成功', applied.code, 0);
  eq('  index = alpha,beta,gamma（无尾换行）', indexContent('nonl.txt'), 'alpha\nbeta\ngamma');

  /* ============================== 场景 8：中文路径 ============================== */
  console.log('\n[8] 中文路径 + 中文内容');
  write('目录/文件 名.txt', '第一行\n第二行\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', '中文文件']);
  write('目录/文件 名.txt', '第一行改\n第二行\n第三行新增\n');
  patches = diffOf('目录/文件 名.txt');
  eq('  路径解析正确', patches[0]?.newPath, '目录/文件 名.txt');
  sel = selectWhere(patches, (l) => l.kind === 'add' && l.text === '第三行新增');
  built = buildSelectedPatch(patches, sel);
  applied = applyIndex(built.patch);
  eq('  git apply 成功', applied.code, 0);
  const cn = indexContent('目录/文件 名.txt');
  check('  index 含新增中文行', cn.includes('第三行新增'), cn);
  check('  index 未含未选中的修改', !cn.includes('第一行改'), cn);

  /* ============================== 场景 9：空选择必须被拒绝 ============================== */
  console.log('\n[9] 空选择不应产生 patch');
  write('multi.txt', `${m2.join('\n')}\n`);
  patches = diffOf('multi.txt');
  const empty = buildSelectedPatch(patches, new Set<string>());
  eq('  patch 为空串', empty.patch, '');
  eq('  count = 0', empty.count, 0);
} catch (e) {
  fail += 1;
  failures.push(`脚本异常：${e instanceof Error ? e.message : String(e)}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const total = pass + fail;
console.log(`\n暂存链路验证：${pass}/${total} 通过`);
if (fail > 0) {
  console.log('\n失败项：');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('全部通过 ✓');
}
