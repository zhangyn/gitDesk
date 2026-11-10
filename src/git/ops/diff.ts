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
  const args = ['diff', '--no-color', '--no-ext-diff', '-U3', '--no-renames'];
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
