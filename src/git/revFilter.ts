import type { LogScope } from './ops/log';

/**
 * 提交图显示哪些分支。
 *
 * - `null`      → 只显示当前分支（**默认**）。实现上只用 `--tags HEAD`，
 *                 **不加 `--branches`**，所以不会出现"排除掉别的分支反而把当前分支一起排掉"的问题
 *                 —— 这个坑真踩过：`HEAD --not <当前分支的后代>` 就等于空集。
 * - `'all'`     → 所有本地分支参与（scope=all 时再加远程分支）
 * - `string[]`  → 当前分支 + 勾选的这些 refname
 */
export type GraphPicked = string[] | 'all' | null;

/** 组装 `git log` 的版本参数（纯函数，便于验证） */
export function graphRevs(picked: GraphPicked, scope: LogScope): string[] {
  if (picked === 'all') {
    return scope === 'all' ? ['--all'] : ['--branches', '--tags', 'HEAD'];
  }
  // 默认与"手动勾选"都从当前分支出发；--tags 保证只在标签上可达的提交也出现
  const base = ['--tags', 'HEAD'];
  if (picked === null) return base;
  return [...base, ...picked];
}

/** 当前分支对应的完整 refname；detached HEAD 时为 null */
export function currentRefOf(head: string | null): string | null {
  return head ? `refs/heads/${head}` : null;
}

/** 勾选框是否应该显示为选中 */
export function isInGraph(
  picked: GraphPicked,
  fullName: string,
  currentRef: string | null,
): boolean {
  if (currentRef && fullName === currentRef) return true; // 当前分支永远参与
  if (picked === 'all') return true;
  if (picked === null) return false;
  return picked.includes(fullName);
}

/**
 * 点击某个分支的勾选框，得到新的选中状态。
 * - 从"全部"里取消一个 → 收敛成显式列表（其余仍然参与）
 * - 从"只看当前"里勾上一个 → 变成 [该分支]
 * - 显式列表取消到空 → 回到默认（只看当前）
 */
export function togglePicked(
  picked: GraphPicked,
  fullName: string,
  allRefNames: string[],
): GraphPicked {
  if (picked === 'all') return allRefNames.filter((x) => x !== fullName);
  if (picked === null) return [fullName];
  const next = picked.includes(fullName)
    ? picked.filter((x) => x !== fullName)
    : [...picked, fullName];
  return next.length === 0 ? null : next;
}
