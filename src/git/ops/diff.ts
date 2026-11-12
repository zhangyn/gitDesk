import { invoke } from '@tauri-apps/api/core';
import type { FilePatch } from '../../types';
import { parsePatches, synthesizeAdded } from '../../parse/diff';
import { runGit } from '../runner';
import { absPath } from './repo';

interface ReadResult {
  text: string;
  binary: boolean;
  truncated: boolean;
  size: number;
}

/* ------------------------------------------------ diff 展示选项（全局生效） */

let ignoreWhitespace = false;
let ignoreEol = false;

/** store 的 setDiffFlag 会同步到这里；之后所有 diff 命令自动带上对应参数 */
export function setDiffFlags(flags: { ignoreWhitespace?: boolean; ignoreEol?: boolean }): void {
  if (flags.ignoreWhitespace !== undefined) ignoreWhitespace = flags.ignoreWhitespace;
  if (flags.ignoreEol !== undefined) ignoreEol = flags.ignoreEol;
}

/** 当前选项对应的 git diff 参数；stash.ts 也用它，保证所有 diff 视图行为一致 */
export function diffViewArgs(): string[] {
  const args: string[] = [];
  if (ignoreWhitespace) args.push('--ignore-all-space');
  if (ignoreEol) args.push('--ignore-cr-at-eol');
  return args;
}

/** 提交内单个文件的 diff（对根提交也成立） */
export async function getCommitDiff(
  repoPath: string,
  sha: string,
  path: string,
): Promise<FilePatch[]> {
  const res = await runGit(
    ['show', '--format=', '--no-color', '--no-ext-diff', '-U3', sha, '--', path],
    { cwd: repoPath, timeoutMs: 60_000 },
  );
  return parsePatches(res.stdout);
}

/** 工作区 / 暂存区的单个文件 diff */
export async function getWorktreeDiff(
  repoPath: string,
  path: string,
  staged: boolean,
): Promise<FilePatch[]> {
  const args = ['diff', '--no-color', '--no-ext-diff', '-U3', '--no-renames', ...diffViewArgs()];
  if (staged) args.push('--cached');
  args.push('--', path);
  const res = await runGit(args, { cwd: repoPath, timeoutMs: 60_000 });
  return parsePatches(res.stdout);
}

/** 未跟踪文件：git diff 看不到，读文件内容合成一个"全新增"patch */
export async function getUntrackedDiff(repoPath: string, path: string): Promise<FilePatch[]> {
  try {
    const res = await invoke<ReadResult>('read_text_file', {
      req: { path: absPath(repoPath, path), maxBytes: 2 * 1024 * 1024 },
    });
    if (res.binary) {
      return [
        {
          oldPath: '/dev/null',
          newPath: path,
          header: [`二进制文件（${res.size} 字节），不展示内容`],
          hunks: [],
          isBinary: true,
          isNew: true,
          isDeleted: false,
        },
      ];
    }
    return [synthesizeAdded(res.text, path, res.truncated)];
  } catch (e) {
    return [
      {
        oldPath: '/dev/null',
        newPath: path,
        header: [`读取失败：${e instanceof Error ? e.message : String(e)}`],
        hunks: [],
        isBinary: false,
        isNew: true,
        isDeleted: false,
      },
    ];
  }
}
