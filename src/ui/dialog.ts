import { create } from 'zustand';

export interface ConfirmRequest {
  kind: 'confirm';
  title: string;
  body?: string;
  okText?: string;
  danger?: boolean;
}

export interface PromptRequest {
  kind: 'prompt';
  title: string;
  label?: string;
  initial?: string;
  placeholder?: string;
  okText?: string;
}

export type DialogRequest = ConfirmRequest | PromptRequest;

interface DialogStore {
  req: DialogRequest | null;
}

export const useDialog = create<DialogStore>()(() => ({ req: null }));

let pending: ((value: unknown) => void) | null = null;

function open<T>(req: DialogRequest): Promise<T> {
  // 同时只允许一个弹窗：后来的先解决掉旧的（返回取消值）
  if (pending) {
    const prev = pending;
    pending = null;
    prev(undefined);
  }
  return new Promise<T>((resolve) => {
    pending = (v) => resolve(v as T);
    useDialog.setState({ req });
  });
}

export function settleDialog(value: unknown): void {
  const resolve = pending;
  pending = null;
  useDialog.setState({ req: null });
  resolve?.(value);
}

export function confirmBox(opts: Omit<ConfirmRequest, 'kind'>): Promise<boolean> {
  return open<boolean>({ kind: 'confirm', ...opts }).then((v) => v === true);
}

export function promptBox(opts: Omit<PromptRequest, 'kind'>): Promise<string | null> {
  return open<string | null>({ kind: 'prompt', ...opts }).then((v) =>
    typeof v === 'string' && v.length > 0 ? v : null,
  );
}
