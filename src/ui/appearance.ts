/**
 * 外观设置：字号 + 行距。
 *
 * 设计原则：
 * - 全站字号都由 `--fs-base` 派生（styles.css 里 font-size 写成 calc(var(--fs-base) * k)），
 *   所以改一个变量就等于整体缩放，不用逐条改样式。
 * - 列表行高由 `--row-h` 决定 = 字号 + 行间距。提交图是用 Canvas 画的，
 *   它的 ROW_HEIGHT 必须在 JS 里拿到同一个值（rowHeightOf），否则节点会和文字错位。
 * - 纯函数放这里，node 环境（验证脚本）也能直接 import：DOM 相关都做了 typeof 守卫。
 */

export type Appearance = {
  /** 正文字号（px） */
  fontSize: number;
  /** 行间距（px）：行高 = 字号 + 行间距 */
  rowGap: number;
};

export const FONT_SIZE_MIN = 11;
export const FONT_SIZE_MAX = 20;
export const ROW_GAP_MIN = 2;
export const ROW_GAP_MAX = 26;

/** 默认值对应原来的视觉：14px 正文 + 32px 行高 */
export const APPEARANCE_DEFAULT: Appearance = { fontSize: 14, rowGap: 18 };

const STORAGE_KEY = 'gitdesk.appearance';

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** 任意输入 → 合法设置（越界夹紧、非数字回落默认、缺字段用默认补齐） */
export function normalizeAppearance(v: unknown): Appearance {
  const raw = (v ?? {}) as Partial<Record<keyof Appearance, unknown>>;
  const pick = (value: unknown, fallback: number, lo: number, hi: number): number =>
    typeof value === 'number' ? clamp(value, lo, hi) : fallback;
  return {
    fontSize: Math.round(
      pick(raw.fontSize, APPEARANCE_DEFAULT.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX),
    ),
    rowGap: Math.round(pick(raw.rowGap, APPEARANCE_DEFAULT.rowGap, ROW_GAP_MIN, ROW_GAP_MAX)),
  };
}

/**
 * 主列表行高：提交历史、文件列表都用它，同时喂给 Canvas 泳道图。
 * 保底 round(fontSize*1.4 + 4)：行距调到最小也不能把文字挤断（踩过：11px+2px 时行高只剩 13px）。
 */
export function rowHeightOf(a: Appearance): number {
  const n = normalizeAppearance(a);
  return Math.max(n.fontSize + n.rowGap, Math.round(n.fontSize * 1.4 + 4));
}

/**
 * 侧栏紧凑行高（分支/标签/Stash/项目列表）。
 * 比主列表矮 6px，但行间距是 1:1 跟随的——调行距时侧栏也要肉眼可见地变。
 * 下限 fontSize + 8：字号拉到 20 时行高不能被压得比文字还矮。
 */
export function rowHeightDenseOf(a: Appearance): number {
  const n = normalizeAppearance(a);
  // 内容本身需要的高度（字号 × 1.45 + 上下留白 6），否则固定行高会把文字切掉
  const content = Math.round(n.fontSize * 1.45 + 6);
  return Math.max(content, rowHeightOf(n) - 6);
}

export function loadAppearance(): Appearance {
  try {
    if (typeof localStorage === 'undefined') return APPEARANCE_DEFAULT;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return APPEARANCE_DEFAULT;
    return normalizeAppearance(JSON.parse(raw) as unknown);
  } catch {
    return APPEARANCE_DEFAULT;
  }
}

export function saveAppearance(a: Appearance): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeAppearance(a)));
  } catch {
    /* 忽略配额错误 */
  }
}

/** 把设置写进 CSS 变量（--fs-base / --row-h） */
export function applyAppearance(a: Appearance): Appearance {
  const n = normalizeAppearance(a);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.style.setProperty('--fs-base', `${n.fontSize}px`);
    root.style.setProperty('--row-h', `${rowHeightOf(n)}px`);
    root.style.setProperty('--row-h-sm', `${rowHeightDenseOf(n)}px`);
  }
  return n;
}
