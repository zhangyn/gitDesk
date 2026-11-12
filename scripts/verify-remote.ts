/**
 * 远程操作验证：用本地 bare 仓库当 origin，跑完整 fetch / pull / push 链路。
 * 不需要网络，也不需要凭据。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { parseStatusV2 } from '../src/parse/status';
import { parseRemoteUrl } from '../src/git/ops/remote';

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

const root = mkdtempSync(join(tmpdir(), 'gitdesk-remote-'));
const BASE = ['-c', 'core.quotepath=false', '-c', 'color.ui=false'];

function git(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', [...BASE, ...args], {
    cwd,
    encoding: 'utf8',
    input,
    maxBuffer: 1 << 26,
  });
}

function tryGit(cwd: string, args: string[]) {
  try {
    return { code: 0, out: git(cwd, args) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, out: String(err.stdout ?? '') + String(err.stderr ?? '') };
  }
}

function write(cwd: string, rel: string, content: string): void {
  const abs = join(cwd, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function initRepo(cwd: string, name = 'T'): void {
  mkdirSync(cwd, { recursive: true });
  git(cwd, ['init', '-q', '-b', 'main']);
  git(cwd, ['config', 'user.name', name]);
  git(cwd, ['config', 'user.email', `${name.toLowerCase()}@example.com`]);
  git(cwd, ['config', 'commit.gpgsign', 'false']);
  git(cwd, ['config', 'core.autocrlf', 'false']);
}

try {
  const originDir = join(root, 'origin.git');
  const aDir = join(root, 'repo-a');
  const bDir = join(root, 'repo-b');

  // 1. bare 仓库当远端
  mkdirSync(originDir, { recursive: true });
  git(originDir, ['init', '-q', '--bare', '-b', 'main']);
  check(
    'bare 仓库已创建',
    tryGit(originDir, ['rev-parse', '--is-bare-repository']).out.trim() === 'true',
  );

  // 2. A 仓库 → 首次推送（--set-upstream）
  initRepo(aDir);
  write(aDir, 'a.txt', 'v1\n');
  git(aDir, ['add', '-A']);
  git(aDir, ['commit', '-q', '-m', 'first']);
  git(aDir, ['remote', 'add', 'origin', originDir]);

  const remotes = git(aDir, ['remote', '-v']);
  check('remote -v 含 origin', remotes.includes('origin'), remotes);
  check('remote -v 同时有 fetch 和 push 行', remotes.trim().split(/\r?\n/).length === 2, remotes);

  // 我们的解析：<name> <url> (fetch|push)
  const parsed = new Map<string, { fetchUrl: string; pushUrl: string }>();
  for (const line of remotes.split(/\r?\n/)) {
    const m = /^(\S+)\s+(.+?)\s+\((fetch|push)\)$/.exec(line.trim());
    if (!m) continue;
    const cur = parsed.get(m[1]) ?? { fetchUrl: '', pushUrl: '' };
    if (m[3] === 'fetch') cur.fetchUrl = m[2];
    else cur.pushUrl = m[2];
    parsed.set(m[1], cur);
  }
  check('解析出 1 个 remote', parsed.size === 1, [...parsed.keys()]);
  check('fetchUrl 正确', parsed.get('origin')?.fetchUrl === originDir, parsed.get('origin'));

  // 3. push --set-upstream refs/heads/main
  const push1 = tryGit(aDir, ['push', '--set-upstream', 'origin', 'refs/heads/main']);
  check('首次推送成功', push1.code === 0, push1.out);
  check(
    '远端已有 main',
    tryGit(originDir, ['rev-parse', '--verify', 'refs/heads/main']).code === 0,
  );

  // 状态里的 upstream / ahead 是否可解析
  const st1 = parseStatusV2(git(aDir, ['status', '--porcelain=v2', '-z', '--branch']));
  check('status 解析出 upstream', st1.branch.upstream === 'origin/main', st1.branch.upstream);
  check('推送后 ahead=0', st1.branch.ahead === 0, st1.branch);

  // 4. 另一个克隆 B 提交并推送
  git(root, ['clone', '-q', originDir, bDir]);
  git(bDir, ['config', 'user.name', 'B']);
  git(bDir, ['config', 'user.email', 'b@example.com']);
  write(bDir, 'b.txt', 'from b\n');
  git(bDir, ['add', '-A']);
  git(bDir, ['commit', '-q', '-m', 'b commit']);
  const pushB = tryGit(bDir, ['push', 'origin', 'refs/heads/main']);
  check('B 推送成功', pushB.code === 0, pushB.out);

  // 5. A fetch --prune --tags 后应该看到 behind=1
  const fetchA = tryGit(aDir, ['fetch', 'origin', '--prune', '--tags']);
  check('fetch 成功', fetchA.code === 0, fetchA.out);
  const st2 = parseStatusV2(git(aDir, ['status', '--porcelain=v2', '-z', '--branch']));
  check('fetch 后 behind=1', st2.branch.behind === 1, st2.branch);
  check('fetch 后 ahead=0', st2.branch.ahead === 0, st2.branch);

  // 6. pull --ff-only 成功且工作区拿到 b.txt
  const pullA = tryGit(aDir, ['pull', '--ff-only']);
  check('pull --ff-only 成功', pullA.code === 0, pullA.out);
  check('工作区出现 b.txt', readFileSync(join(aDir, 'b.txt'), 'utf8') === 'from b\n');
  const st3 = parseStatusV2(git(aDir, ['status', '--porcelain=v2', '-z', '--branch']));
  check('pull 后 behind=0', st3.branch.behind === 0, st3.branch);

  // 7. 非快进时 --ff-only 必须失败（不能偷偷生成 merge commit）
  write(aDir, 'a.txt', 'v2 local\n');
  git(aDir, ['commit', '-q', '-am', 'local change']);
  write(bDir, 'b.txt', 'from b v2\n');
  git(bDir, ['commit', '-q', '-am', 'b change 2']);
  tryGit(bDir, ['push', 'origin', 'refs/heads/main']);
  tryGit(aDir, ['fetch', 'origin']);

  const pullFail = tryGit(aDir, ['pull', '--ff-only']);
  check('分叉时 pull --ff-only 被拒绝', pullFail.code !== 0, pullFail.out);
  check(
    '拒绝后没有产生 merge commit',
    tryGit(aDir, ['rev-parse', '--verify', 'MERGE_HEAD']).code !== 0,
  );

  // 8. 普通 push 在分叉时被拒绝
  const pushReject = tryGit(aDir, ['push', 'origin', 'refs/heads/main']);
  check('分叉时 push 被拒绝（non-fast-forward）', pushReject.code !== 0, pushReject.out);
  check(
    '错误信息能被 humanize 识别',
    /non-fast-forward|rejected|fetch first/i.test(pushReject.out),
    pushReject.out.slice(0, 120),
  );

  // 9. --force-with-lease 可用（A 明确要覆盖远端）
  const pushLease = tryGit(aDir, ['push', '--force-with-lease', 'origin', 'refs/heads/main']);
  check('--force-with-lease 成功', pushLease.code === 0, pushLease.out);

  // 10. --force-with-lease 在「没 fetch 就推」时被拒绝（lease 的核心价值）
  //     B 先对齐被强推后的远端，再推进一个提交
  tryGit(bDir, ['fetch', 'origin']);
  git(bDir, ['reset', '--hard', '-q', 'origin/main']);
  write(bDir, 'b.txt', 'from b v3\n');
  git(bDir, ['commit', '-q', '-am', 'b change 3']);
  const pushB3 = tryGit(bDir, ['push', 'origin', 'refs/heads/main']);
  check('B 对齐后再次推送成功', pushB3.code === 0, pushB3.out);

  // A 不 fetch，用旧的 remote-tracking 值作为 lease → 应该被拒
  write(aDir, 'a.txt', 'v3 local\n');
  git(aDir, ['commit', '-q', '-am', 'local change 3']);
  const leaseStale = tryGit(aDir, ['push', '--force-with-lease', 'origin', 'refs/heads/main']);
  check('lease 过期时强推被拒绝（防止覆盖别人）', leaseStale.code !== 0, leaseStale.out);

  // 10.5 凭据注入：与 src/git/runner.ts 的 AUTH_HELPER 完全一致的写法
  const helper = '!f() { echo username=$GD_USER; echo password=$GD_PASS; }; f';
  const filled = execFileSync(
    'git',
    ['-c', 'credential.helper=', '-c', `credential.helper=${helper}`, 'credential', 'fill'],
    {
      cwd: aDir,
      input: 'protocol=https\nhost=example.test\n\n',
      encoding: 'utf8',
      env: { ...process.env, GD_USER: 'u-test', GD_PASS: 'p-test' },
    },
  );
  check('凭据：env 注入能被 credential helper 回填', filled.includes('username=u-test'), filled);
  check('凭据：密码同样来自 env', filled.includes('password=p-test'), filled);

  // remote URL 解析（决定凭据要写到哪个 host）
  eq('remote 解析：https', parseRemoteUrl('https://github.com/zhangyn/gitDesk.git'), {
    protocol: 'https',
    host: 'github.com',
    path: 'zhangyn/gitDesk',
  });
  eq('remote 解析：带用户名', parseRemoteUrl('https://user@git.example.com/a/b.git'), {
    protocol: 'https',
    host: 'git.example.com',
    path: 'a/b',
  });
  eq('remote 解析：SSH 不处理', parseRemoteUrl('git@github.com:a/b.git'), null);

  // 11. 拉取策略：rebase
  tryGit(aDir, ['fetch', 'origin']);
  const pullRebase = tryGit(aDir, ['pull', '--rebase']);
  check('pull --rebase 成功', pullRebase.code === 0, pullRebase.out);
  const logA = git(aDir, ['log', '--oneline', '-n', '5']);
  check('rebase 后历史是线性的（无 merge 提交）', !/Merge branch/i.test(logA), logA);
} catch (e) {
  fail += 1;
  failures.push(`脚本异常：${e instanceof Error ? e.message : String(e)}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

const total = pass + fail;
console.log(`\n远程操作验证：${pass}/${total} 通过`);
if (fail > 0) {
  console.log('\n失败项：');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exitCode = 1;
} else {
  console.log('全部通过 ✓');
}
