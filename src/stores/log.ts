import { create } from 'zustand';
import type { GitRunResult } from '../types';

export interface LogEntry {
  id: number;
  argv: string[];
  cwd: string;
  code: number;
  durationMs: number;
  stderr: string;
  at: number;
}

interface LogState {
  entries: LogEntry[];
  open: boolean;
  push: (argv: string[], cwd: string, res: GitRunResult) => void;
  clear: () => void;
  toggle: () => void;
}

let seq = 0;
const MAX_ENTRIES = 300;

export const useLog = create<LogState>()((set) => ({
  entries: [],
  open: true,
  push: (argv, cwd, res) =>
    set((s) => {
      const next: LogEntry[] = [
        ...s.entries,
        {
          id: ++seq,
          argv,
          cwd,
          code: res.code,
          durationMs: res.durationMs,
          stderr: (res.stderr || '').trim(),
          at: Date.now(),
        },
      ];
      return { entries: next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next };
    }),
  clear: () => set({ entries: [] }),
  toggle: () => set((s) => ({ open: !s.open })),
}));

const SAFE = /^[A-Za-z0-9_\-.,:+=/@%^~[\]{}]+$/;

function quoteArg(a: string): string {
  if (a === '') return "''";
  if (SAFE.test(a)) return a;
  return `"${a.replace(/"/g, '\\"')}"`;
}

/** 把 argv 还原成可以直接粘到终端里跑的等价命令。 */
export function formatCommand(argv: string[]): string {
  // Rust 侧会注入 -c core.quotepath=false 等参数，日志里展示时保留，保证"复制即可运行"
  return ['git', ...argv].map(quoteArg).join(' ');
}
