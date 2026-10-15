import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Copy, RotateCw } from 'lucide-react';
import { browser } from 'wxt/browser';

const ISSUES_URL = 'https://github.com/DainamoLabs/LatentNest/issues';

interface State {
  error: Error | null;
  componentStack?: string | null;
  copied: boolean;
}

/** Replaces a crashed UI with a way out, instead of a blank panel. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack });
    console.error('LatentNest: the interface crashed', error);
  }

  details() {
    const { error, componentStack } = this.state;
    return [
      `LatentNest ${browser.runtime.getManifest().version}`,
      navigator.userAgent,
      location.pathname + location.hash,
      '',
      error?.stack || String(error),
      componentStack ? `\nComponent stack:${componentStack}` : '',
    ].join('\n');
  }

  copy = async () => {
    await navigator.clipboard.writeText(this.details()).catch(() => {});
    this.setState({ copied: true });
  };

  override render() {
    const { error, copied } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="app">
        <div className="empty crash" role="alert">
          <img src="/logo.png" alt="" />
          <strong>Something went wrong</strong>
          <p>This view hit an error. Your datasets and captions are safe: they're stored separately, and reloading usually fixes it.</p>
          <code className="crash-message">{error.message || String(error)}</code>
          <div className="crash-actions">
            <button className="btn btn-primary" onClick={() => location.reload()}>
              <RotateCw size={15} />
              Reload
            </button>
            <button className="btn" onClick={() => void this.copy()}>
              <Copy size={15} />
              {copied ? 'Copied' : 'Copy error details'}
            </button>
          </div>
          <p>
            If it keeps happening, please{' '}
            <a href={ISSUES_URL} target="_blank" rel="noreferrer">
              report it
            </a>{' '}
            with the copied details.
          </p>
        </div>
      </div>
    );
  }
}
