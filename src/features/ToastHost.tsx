import { useToast } from '../stores/toast';

/** 右下角的轻量成功提示堆栈（自动消失，可手动点掉） */
export function ToastHost() {
  const entries = useToast((s) => s.entries);
  const dismiss = useToast((s) => s.dismiss);
  if (entries.length === 0) return null;
  return (
    <div className="toast-host">
      {entries.map((t) => (
        <button
          key={t.id}
          className={`toast toast-${t.tone}`}
          title="点击关闭"
          onClick={() => dismiss(t.id)}
        >
          {t.tone === 'ok' ? '✓ ' : ''}
          {t.text}
        </button>
      ))}
    </div>
  );
}
