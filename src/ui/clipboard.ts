/**
 * 复制文本到剪贴板。Tauri 的 WebView2 支持 async clipboard API，
 * 但焦点异常时可能抛错，退化到 execCommand 兜底。
 * 返回是否成功，调用方决定要不要给用户提示。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
