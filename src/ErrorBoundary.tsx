import { Component, type ErrorInfo, type ReactNode } from 'react';

// The panel is hidden rather than closed, so without this a render error would blank it for the whole session.
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown, info: ErrorInfo) { console.error('MeterLuma could not render the panel.', error, info.componentStack); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="error-boundary" role="alert" aria-labelledby="error-boundary-title">
      <h1 id="error-boundary-title">Something went wrong.</h1>
      <p>MeterLuma could not show this panel. Your settings and connections are unchanged. Reload to try again.</p>
      <button className="button primary" onClick={() => window.location.reload()}>Reload</button>
    </main>;
  }
}
