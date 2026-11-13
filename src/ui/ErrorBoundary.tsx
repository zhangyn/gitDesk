import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 渲染异常兜底：之前任何组件抛错都会整窗白屏。
 * 出错时显示错误详情 + 重载按钮，而不是把用户丢在白屏里。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('渲染异常：', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error-boundary">
        <div className="eb-title">界面出现了一个错误</div>
        <pre className="eb-detail">{error.message}</pre>
        <button className="btn primary" onClick={() => window.location.reload()}>
          重新加载
        </button>
      </div>
    );
  }
}
