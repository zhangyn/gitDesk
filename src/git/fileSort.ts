import type { StatusEntry } from '../types';

/**
 * 工作区文件列表的排序。
 *
 * 纯函数放这里，便于验证脚本直接断言（不依赖 React / store）。
 */

export type FileSortMode = 'name' | 'status';
export type SortDir = 'asc' | 'desc';

export type FileSort = {
  mode: FileSortMode;
  dir: SortDir;
};

export const FILE_SORT_DEFAULT: FileSort = { mode: 'status', dir: 'asc' };

const STORAGE_KEY = 'gitdesk.fileSort';

/** 状态分组次序：冲突最急 → 已暂存 → 未暂存 → 未跟踪 */
export function statusRank(e: StatusEntry): number {
  if (e.kind === 'unmerged' || e.index === 'U' || e.worktree === 'U') return 0;
  if (e.kind === 'untracked') return 3;
  if (e.index !== '.' && e.index !== ' ') return 1;
  return 2;
}

/** 文件名比较：大小写不敏感，相同再按原串，保证稳定（不随刷新跳动） */
function comparePath(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la !== lb) return la < lb ? -1 : 1;
  if (a !== b) return a < b ? -1 : 1;
  return 0;
}

export function sortEntries<T extends StatusEntry>(list: T[], sort: FileSort): T[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const out = [...list];
  out.sort((a, b) => {
    if (sort.mode === 'status') {
      const ra = statusRank(a);
      const rb = statusRank(b);
      if (ra !== rb) return (ra - rb) * sign;
    }
    // 名称永远作为第二关键字，保证同组内可预期
    return comparePath(a.path, b.path) * (sort.mode === 'status' ? 1 : sign);
  });
  return out;
}

/** 点同一个模式 → 翻转方向；点另一个模式 → 换成该模式并回到升序 */
export function nextSort(cur: FileSort, mode: FileSortMode): FileSort {
  if (cur.mode === mode) return { mode, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { mode, dir: 'asc' };
}

export function normalizeSort(v: unknown): FileSort {
  const raw = (v ?? {}) as Partial<Record<keyof FileSort, unknown>>;
  const mode: FileSortMode = raw.mode === 'name' ? 'name' : 'status';
  const dir: SortDir = raw.dir === 'desc' ? 'desc' : 'asc';
  return { mode, dir };
}

export function loadFileSort(): FileSort {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return FILE_SORT_DEFAULT;
    return normalizeSort(JSON.parse(raw) as unknown);
  } catch {
    return FILE_SORT_DEFAULT;
  }
}

export function saveFileSort(sort: FileSort): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSort(sort)));
  } catch {
    /* 忽略配额错误 */
  }
}
