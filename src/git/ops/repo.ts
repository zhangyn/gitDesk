import type { RepoInfo } from '../../types';
import { runGit } from '../runner';

/** 打开并校验一个目录是不是 Git 工作区。失败时抛 Error（消息可直接展示）。 */
export async function openRepo(dir: string): Promise<RepoInfo> {
  const bare = await runGit(['rev-parse', '--is-bare-repository'], { cwd: dir, quiet: true });
  if (bare.code !== 0) {
    throw new Error(
      `不是 Git 仓库：${dir}\n${(bare.stderr || bare.stdout).trim()}`.trim(),
    );
  }
  if (bare.stdout.trim() === 'true') {
    throw new Error('暂不支持 bare 仓库（M0 仅支持带工作区的仓库）');
  }

  const top = await runGit(['rev-parse', '--show-toplevel'], { cwd: dir, quiet: true });
  if (top.code !== 0) {
    throw new Error(`无法解析仓库根目录：${(top.stderr || top.stdout).trim()}`);
  }

  const gitDir = await runGit(['rev-parse', '--absolute-git-dir'], { cwd: dir, quiet: true });

  const path = top.stdout.trim();
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  return { path, gitDir: gitDir.stdout.trim(), name };
}

/** 把仓库内相对路径转成绝对路径（git 一律用 / 分隔） */
export function absPath(repoRoot: string, rel: string): string {
  const root = repoRoot.replace(/[\\/]+$/, '');
  return `${root}/${rel}`;
}
