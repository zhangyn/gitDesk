import { invoke } from '@tauri-apps/api/core';
import type { GitRunResult, ProbeResult } from '../types';
import { useLog } from '../stores/log';

/**
 * 注：core.quotepath / color / pager 由 Rust 侧统一注入（见 src-tauri/src/git_cmd.rs），
 * 这里只管业务参数，保证命令日志里看到的 argv 与真实执行的一致。
 */
let gitPath = 'git';

/**
 * 我们自己跑的 git 命令会改磁盘（add/commit/checkout…），这些变化由调用方主动 reload。
 * 记录一个时间窗，让文件监听在这个窗口内保持安静，避免"操作 → 监听 → 又刷新"的抖动。
 */
let suppressUntil = 0;
export function watcherSuppressed(): boolean {
  return Date.now() < suppressUntil;
}

export function setGitPath(p: string): void {
  if (p && p.length > 0) gitPath = p;
}

export function getGitPath(): string {
  return gitPath;
}

export async function probeGit(): Promise<ProbeResult> {
  const res = await invoke<ProbeResult>('git_probe');
  if (res.found) setGitPath(res.path);
  return res;
}

export interface GitOpts {
  cwd: string;
  /** 通过 stdin 喂给 git（例如 git apply 的 patch） */
  input?: string;
  timeoutMs?: number;
  /** 内部探测类命令，不写入操作日志 */
  quiet?: boolean;
}

/**
 * 唯一的 git 调用入口。整个应用不允许出现第二个 spawn。
 * 失败不抛异常，由调用方检查 code —— git 很多"非零但正常"的返回。
 */
export async function runGit(args: string[], opts: GitOpts): Promise<GitRunResult> {
  let res: GitRunResult;
  try {
    res = await invoke<GitRunResult>('git_run', {
      req: {
        args,
        cwd: opts.cwd,
        opId: null,
        timeoutMs: opts.timeoutMs ?? 120_000,
        input: opts.input ?? null,
        gitPath,
      },
    });
  } catch (e) {
    res = {
      code: -1,
      stdout: '',
      stderr: typeof e === 'string' ? e : String(e),
      durationMs: 0,
      command: `git ${args.join(' ')}`,
      timedOut: false,
    };
  }
  if (!opts.quiet) useLog.getState().push(args, opts.cwd, res);
  suppressUntil = Date.now() + 800;
  return res;
}

/** 需要成功时才用这个：非零退出码抛 Error（消息取 stderr）。 */
export async function runGitChecked(args: string[], opts: GitOpts): Promise<GitRunResult> {
  const res = await runGit(args, opts);
  if (res.code !== 0) {
    const msg = (res.stderr || res.stdout).trim() || `git 退出码 ${res.code}`;
    throw new Error(msg);
  }
  return res;
}

export async function cancelGit(opId: string): Promise<boolean> {
  return invoke<boolean>('git_cancel', { opId });
}
