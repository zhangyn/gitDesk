import { create } from 'zustand';

export interface ToastEntry {
  id: number;
  text: string;
  /** 正向操作（成功绿）还是中性提示 */
  tone: 'ok' | 'info';
}

interface ToastState {
  entries: ToastEntry[];
  push: (text: string, tone?: ToastEntry['tone']) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

/**
 * 轻量成功反馈：写操作完成时用户需要一句"做成了"的确认。
 * 自动 3 秒消失，不抢占焦点（区别于错误条）。
 */
export const useToast = create<ToastState>()((set) => ({
  entries: [],
  push: (text, tone = 'ok') => {
    const id = ++seq;
    set((s) => ({ entries: [...s.entries.slice(-4), { id, text, tone }] }));
    window.setTimeout(() => {
      set((s) => ({ entries: s.entries.filter((t) => t.id !== id) }));
    }, 3000);
  },
  dismiss: (id) => set((s) => ({ entries: s.entries.filter((t) => t.id !== id) })),
}));

/** 供 store.ts 等 js 模块直接调用的便捷函数 */
export function toast(text: string, tone: ToastEntry['tone'] = 'ok'): void {
  useToast.getState().push(text, tone);
}
