export type Theme = 'dark' | 'light' | 'system';

const KEY = 'gitdesk.theme';

export function loadTheme(): Theme {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

function resolve(theme: Theme): 'dark' | 'light' {
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** 写到 <html data-theme="...">，CSS 里靠这个属性切变量 */
export function applyTheme(theme: Theme): void {
  const resolved = resolve(theme);
  document.documentElement.setAttribute('data-theme', resolved);
  localStorage.setItem(KEY, theme);
}

/** system 模式下跟随系统切换 */
export function watchSystemTheme(onChange: () => void): void {
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const handler = () => onChange();
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', handler);
}

/**
 * 把主题同步给 Tauri 原生窗口（Windows 标题栏 / 边框）。
 * 不这么做的话，浅色主题下最上面的标题栏还是黑的。
 */
export async function syncWindowTheme(theme: Theme): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setTheme(theme === 'system' ? null : theme);
  } catch {
    /* 浏览器环境或权限缺失时忽略 */
  }
}

export const THEME_LABEL: Record<Theme, string> = {
  dark: '深色',
  light: '浅色',
  system: '跟随系统',
};

export function nextTheme(t: Theme): Theme {
  return t === 'dark' ? 'light' : t === 'light' ? 'system' : 'dark';
}
