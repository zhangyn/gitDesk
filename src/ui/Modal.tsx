import { useEffect, useState } from 'react';
import { settleDialog, useDialog } from './dialog';

/**
 * Tauri 的 WebView2 里 window.confirm / prompt 行为不可靠，
 * 所以自己实现一个最小可用的模态框。
 */
export function ModalHost() {
  const req = useDialog((s) => s.req);
  const [text, setText] = useState('');

  useEffect(() => {
    if (req?.kind === 'prompt') setText(req.initial ?? '');
  }, [req]);

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        settleDialog(req.kind === 'confirm' ? false : null);
      }
      if (e.key === 'Enter' && req.kind === 'prompt') {
        e.preventDefault();
        settleDialog(text);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [req, text]);

  if (!req) return null;

  const cancel = () => settleDialog(req.kind === 'confirm' ? false : null);
  const ok = () => settleDialog(req.kind === 'confirm' ? true : text);

  return (
    <div className="modal-mask" onMouseDown={cancel}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{req.title}</div>
        {req.kind === 'confirm' && req.body && <div className="modal-body">{req.body}</div>}
        {req.kind === 'prompt' && (
          <>
            {req.label && <div className="modal-label">{req.label}</div>}
            <input
              className="modal-input"
              autoFocus
              value={text}
              placeholder={req.placeholder}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
            />
          </>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={cancel}>
            取消
          </button>
          <button
            className={`btn ${req.kind === 'confirm' && req.danger ? 'danger' : 'primary'}`}
            onClick={ok}
            autoFocus={req.kind === 'confirm'}
          >
            {req.okText ?? (req.kind === 'confirm' ? '确定' : '确定')}
          </button>
        </div>
      </div>
    </div>
  );
}
