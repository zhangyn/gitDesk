/**
 * 对比视图 + 历史搜索的命令语义验证。
 *
 * 这些能力由「store 拼 argv → runner 执行」实现，而 runner 依赖 Tauri，
 * 所以这里直接跑**同样的 argv**（与 src/git/ops/{compare,log}.ts 保持一致），
 * 再把输出喂给我们的解析器断言。被验证的是"命令语义 + 解析"这一层，
 * 也就是真出 bug 的地方。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { parseLog } from '../src/parse/log';

const BASE = ['-c', 'core.quotepath=false', '-c', 'color.ui=false'];
const FORMAT =
  ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%s', '%D'].join('%x1f') + '%x1e';

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

const dir = mkdtempSync(join(tmpdir(), 'gitdesk-cmp-'));

function git(args: string[]): string {
  return execFileSync('git', [...BASE, ...args], {
    cwd: dir,
    encoding: 'utf8',
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

function write(rel: string, content: string): void {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

/** 与 src/git/ops/compare.ts 一致的 name-status 解析 */
function parseNameStatus(out: string): Array<{ path: string; status: string }> {
  const tokens = out.split('\0').filter((t) => t.length > 0);
  const files: Array<{ path: string; status: string }> = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const status = tokens[i];
    const path = tokens[i + 1];
    if (!status || !path) break;
    files.push({ path, status: status[0] });
  }
  return files;
}

try {
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'T']);
  git(['config', 'user.email', 't@example.com']);
  git(['config', 'core.autocrlf', 'false']);

  // 基线：5 个提交
  write('a.txt', 'a1\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'feat: 初始提交']);
  for (let i = 1; i <= 4; i++) {
    write('a.txt', `a1\nline${i}\n`);
    git(['commit', '-q', '-am', `feat: 第 ${i} 次修改 a.txt`]);
  }
  const base = git(['rev-parse', 'HEAD']).trim();

  // 分支 feature：从基线再走 3 个提交
  git(['checkout', '-q', '-b', 'feature']);
  write('b.txt', 'b1\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'feat(搜索目标): 新增 b.txt 供检索']);
  write('a.txt', 'a1\nchanged on feature\n');
  write('c.txt', 'c1\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'fix: 修改 a.txt 并新增 c.txt']);
  git(['commit', '-q', '--allow-empty', '-m', 'chore: 空提交']);
  const featureTip = git(['rev-parse', 'HEAD']).trim();

  // main 上再走 2 个提交，制造分叉 + 合并
  git(['checkout', '-q', 'main']);
  write('d.txt', 'd1\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'feat: main 上的 d.txt']);
  git(['merge', '-q', '--no-ff', 'feature', '-m', 'merge: 合并 feature']);

  /* ---------------------------------------------------------- 分支对比 */
  const diffOut = git(['diff', '--name-status', '-z', '--no-renames', base, featureTip]);
  const files = parseNameStatus(diffOut);
  const paths = files.map((f) => f.path).sort();
  eq('分支对比：文件列表', paths, ['a.txt', 'b.txt', 'c.txt']);
  eq(
    '分支对比：状态字母',
    files.sort((x, y) => x.path.localeCompare(y.path)).map((f) => f.status),
    ['M', 'A', 'A'],
  );
  check('分支对比：b.txt 存在', paths.includes('b.txt'));
  check('分支对比：d.txt 不在（右侧没有）', !paths.includes('d.txt'));

  const count = Number(git(['rev-list', '--count', `${base}..${featureTip}`]).trim());
  eq('分支对比：中间提交数 = 3', count, 3);

  const stat = git(['diff', '--shortstat', base, featureTip]).trim();
  const ins = /(\d+) insertion/.exec(stat);
  const del = /(\d+) deletion/.exec(stat);
  const nfiles = /(\d+) file/.exec(stat);
  check('分支对比：shortstat 能解析出文件数', nfiles?.[1] === '3', stat);
  check('分支对比：shortstat 能解析出增删行', Boolean(ins) && Boolean(del), stat);

  // 提交 A ↔ 提交 B（中间隔多次提交）：净差异
  const midA = git(['rev-parse', 'HEAD~6']).trim();
  const midB = git(['rev-parse', 'HEAD~1']).trim();
  const midFiles = parseNameStatus(
    git(['diff', '--name-status', '-z', '--no-renames', midA, midB]),
  );
  check('两次提交对比：有文件差异', midFiles.length > 0, midFiles);
  const midCount = Number(git(['rev-list', '--count', `${midA}..${midB}`]).trim());
  check('两次提交对比：中间提交数 > 1', midCount > 1, midCount);

  // 单文件 diff
  const fileDiff = git([
    'diff',
    '--no-color',
    '--no-ext-diff',
    '-U3',
    base,
    featureTip,
    '--',
    'a.txt',
  ]);
  check('单文件对比：输出含 diff --git', fileDiff.startsWith('diff --git'), fileDiff.slice(0, 40));
  check('单文件对比：含 +/- 行', /^[+-][^+-]/m.test(fileDiff));

  /* ---------------------------------------------------------- 历史搜索 */
  // 说明搜索：固定串 + 忽略大小写 + 中文
  const grepOut = git([
    'log',
    '--topo-order',
    '-n',
    '50',
    `--format=${FORMAT}`,
    '-i',
    '--fixed-strings',
    '--grep=搜索目标',
    '--branches',
    '--tags',
    'HEAD',
  ]);
  const grepCommits = parseLog(grepOut);
  eq('说明搜索：命中 1 条', grepCommits.length, 1);
  check(
    '说明搜索：命中的是正确的提交',
    grepCommits[0]?.subject.includes('搜索目标') === true,
    grepCommits[0]?.subject,
  );

  // 大小写不敏感
  const upper = parseLog(
    git([
      'log',
      '-n',
      '50',
      `--format=${FORMAT}`,
      '-i',
      '--fixed-strings',
      '--grep=FEAT(搜索目标)',
      '--branches',
      'HEAD',
    ]),
  );
  check('说明搜索：忽略大小写', upper.length === 1, upper.length);

  // 文件搜索：子串通配
  const pathOut = git([
    'log',
    '--topo-order',
    '-n',
    '50',
    `--format=${FORMAT}`,
    '--branches',
    '--tags',
    'HEAD',
    '--',
    '*b.txt*',
  ]);
  const pathCommits = parseLog(pathOut);
  eq('文件搜索：b.txt 被提交 1 次', pathCommits.length, 1);

  const pathOut2 = git([
    'log',
    '--topo-order',
    '-n',
    '50',
    `--format=${FORMAT}`,
    '--branches',
    'HEAD',
    '--',
    '*a.txt*',
  ]);
  check('文件搜索：a.txt 命中多次', parseLog(pathOut2).length >= 3, parseLog(pathOut2).length);

  // 精确路径也能搜（子串通配包含完整路径）
  const exact = git([
    'log',
    '-n',
    '50',
    `--format=${FORMAT}`,
    '--branches',
    'HEAD',
    '--',
    '*c.txt*',
  ]);
  eq('文件搜索：精确路径同样命中', parseLog(exact).length, 1);

  // 不存在的文件 → 空结果，不报错
  const none = tryGit([
    'log',
    '-n',
    '50',
    `--format=${FORMAT}`,
    '--branches',
    'HEAD',
    '--',
    '*no-such-file-xyz*',
  ]);
  eq('文件搜索：无命中时不报错', none.code, 0);
  eq('文件搜索：无命中时结果为空', parseLog(none.out).length, 0);

  // 特殊字符不应把命令搞崩（paths 是通配语法，* 会被当通配但不会报错）
  const weird = tryGit([
    'log',
    '-n',
    '5',
    `--format=${FORMAT}`,
    '--branches',
    'HEAD',
    '--',
    '*a[.txt*',
  ]);
  check('文件搜索：含特殊字符不报错', weird.code === 0, weird.out.slice(0, 80));

  /* --- 关键回归断言：只在「未合并分支」上的提交也必须能被搜到 ---
     如果 --branches 被错放到 `--` 之后，git 会把它当路径，搜索范围退化成只有 HEAD，
     这条断言就会挂（这正是我第一版写错的地方） */
  git(['checkout', '-q', '-b', 'solo-only', 'main']);
  write('solo.txt', 'solo\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'feat: 只在 solo-only 分支上的文件']);
  const soloSha = git(['rev-parse', 'HEAD']).trim();
  git(['checkout', '-q', 'main']);

  const soloSearch = tryGit([
    'log',
    '-n',
    '20',
    `--format=${FORMAT}`,
    '--branches',
    'HEAD',
    '--',
    '*solo.txt*',
  ]);
  const soloHits = parseLog(soloSearch.out);
  eq('文件搜索：能搜到未合并分支上的提交', soloHits.length, 1);
  eq('文件搜索：命中的是 solo-only 的提交', soloHits[0]?.sha?.slice(0, 7), soloSha.slice(0, 7));

  const soloMiss = tryGit(['log', '-n', '20', `--format=${FORMAT}`, 'HEAD', '--', '*solo.txt*']);
  eq('对照：只搜 HEAD 时搜不到（证明范围参数真的生效）', parseLog(soloMiss.out).length, 0);

  // rev 解析：合法/非法
  eq(
    'rev 解析：HEAD 可解析',
    tryGit(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']).code,
    0,
  );
  eq(
    'rev 解析：不存在的分支被拒绝',
    tryGit(['rev-parse', '--verify', '--quiet', 'no-such-branch^{commit}']).code,
    1,
  );
} catch (e) {
  fail += 1;
  failures.push(`脚本异常：${e instanceof Error ? e.message : String(e)}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const total = pass + fail;
console.log(`\n对比与搜索验证：${pass}/${total} 通过`);
if (fail > 0) {
  console.log('\n失败项：');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('全部通过 ✓');
}
