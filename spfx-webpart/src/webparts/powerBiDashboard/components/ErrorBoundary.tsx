import * as React from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface IErrorBoundaryProps {
  /** Optional custom fallback renderer.  Receives the error and a retry callback. */
  fallback?: (error: Error, retry: () => void, errorCount: number) => React.ReactNode;
  /** Called whenever an error is caught. */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  /** Maximum retries before showing "contact support" messaging. Default: 3. */
  maxRetries?: number;
  /** Component name shown in the error UI for context. */
  componentName?: string;
  /** Child components to render. */
  children: React.ReactNode;
}

interface IErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  errorCount: number;
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
    padding: 32,
    fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif',
  },
  card: {
    maxWidth: 520,
    width: '100%',
    background: '#ffffff',
    borderRadius: 8,
    boxShadow: '0 2px 8px rgba(0,0,0,0.08), 0 0 1px rgba(0,0,0,0.12)',
    overflow: 'hidden',
  },
  errorBar: {
    height: 4,
    background: 'linear-gradient(90deg, #d13438, #ef6950)',
    borderRadius: '8px 8px 0 0',
  },
  body: {
    padding: '24px 28px',
  },
  iconRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: '50%',
    background: '#fde7e9',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
    color: '#242424',
    margin: 0,
  },
  subtitle: {
    fontSize: 13,
    color: '#616161',
    marginTop: 4,
    lineHeight: '1.5',
  },
  errorMessage: {
    background: '#faf9f8',
    border: '1px solid #edebe9',
    borderRadius: 4,
    padding: '10px 14px',
    fontSize: 12,
    fontFamily: '"Cascadia Code", "Consolas", monospace',
    color: '#605e5c',
    wordBreak: 'break-word' as const,
    marginTop: 16,
    maxHeight: 120,
    overflow: 'auto',
  },
  actions: {
    display: 'flex',
    gap: 8,
    marginTop: 20,
  },
  retryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 20px',
    fontSize: 13,
    fontWeight: 600,
    color: '#ffffff',
    background: '#0078d4',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  reloadButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 20px',
    fontSize: 13,
    fontWeight: 600,
    color: '#242424',
    background: '#f3f2f1',
    border: '1px solid #d2d0ce',
    borderRadius: 4,
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  supportBox: {
    background: '#fff4ce',
    border: '1px solid #f4d67e',
    borderRadius: 4,
    padding: '12px 16px',
    marginTop: 16,
    fontSize: 13,
    color: '#6e5400',
    lineHeight: '1.5',
  },
  retryCount: {
    fontSize: 11,
    color: '#a19f9d',
    marginTop: 12,
  },
};

// ─── Component ──────────────────────────────────────────────────────────────

export class ErrorBoundary extends React.Component<
  IErrorBoundaryProps,
  IErrorBoundaryState
> {
  public static defaultProps: Partial<IErrorBoundaryProps> = {
    maxRetries: 3,
    componentName: 'Power BI Dashboard',
  };

  constructor(props: IErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0,
    };
  }

  public static getDerivedStateFromError(error: Error): Partial<IErrorBoundaryState> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    const newCount = this.state.errorCount + 1;
    this.setState({ errorInfo, errorCount: newCount });

    // Log structured error context
    console.error(
      `[ErrorBoundary] ${this.props.componentName} error #${newCount}:`,
      {
        error: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        timestamp: new Date().toISOString(),
      },
    );

    this.props.onError?.(error, errorInfo);
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  public render(): React.ReactNode {
    const { hasError, error, errorCount } = this.state;
    const { children, fallback, maxRetries, componentName } = this.props;

    if (!hasError || !error) {
      return children;
    }

    // Custom fallback renderer
    if (fallback) {
      return fallback(error, this.handleRetry, errorCount);
    }

    const isExhausted = errorCount >= (maxRetries ?? 3);

    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.errorBar} />
          <div style={styles.body}>
            {/* Header */}
            <div style={styles.iconRow}>
              <div style={styles.iconCircle}>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="#d13438"
                >
                  <path d="M10 2a8 8 0 100 16 8 8 0 000-16zM9 6h2v5H9V6zm0 7h2v2H9v-2z" />
                </svg>
              </div>
              <div>
                <h3 style={styles.title}>
                  {isExhausted ? 'Persistent Error' : 'Something went wrong'}
                </h3>
                <p style={styles.subtitle}>
                  {isExhausted
                    ? `${componentName} has encountered repeated errors and cannot recover automatically.`
                    : `${componentName} encountered an unexpected error. You can try again or reload the page.`}
                </p>
              </div>
            </div>

            {/* Error detail */}
            <div style={styles.errorMessage}>
              {error.name}: {error.message}
            </div>

            {/* Contact support after max retries */}
            {isExhausted && (
              <div style={styles.supportBox}>
                <strong>Need help?</strong> Please contact your SharePoint
                administrator or IT support team with the error details above.
                Reference the browser console for full diagnostic information.
              </div>
            )}

            {/* Retry count */}
            <div style={styles.retryCount}>
              Attempt {errorCount} of {maxRetries}
            </div>

            {/* Actions */}
            <div style={styles.actions}>
              {!isExhausted && (
                <button
                  style={styles.retryButton}
                  onClick={this.handleRetry}
                  onMouseOver={(e) =>
                    ((e.target as HTMLButtonElement).style.background = '#106ebe')
                  }
                  onMouseOut={(e) =>
                    ((e.target as HTMLButtonElement).style.background = '#0078d4')
                  }
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path d="M8 3a5 5 0 014.546 2.914l.09.186L14 4v4h-4l1.67-1.67A3.5 3.5 0 008 4.5a3.5 3.5 0 00-.206 6.994L8 11.5a3.5 3.5 0 003.293-2.327l.058-.173H12.9A5.002 5.002 0 018 13a5 5 0 010-10z" />
                  </svg>
                  Try Again
                </button>
              )}
              <button
                style={styles.reloadButton}
                onClick={this.handleReload}
                onMouseOver={(e) =>
                  ((e.target as HTMLButtonElement).style.background = '#e1dfdd')
                }
                onMouseOut={(e) =>
                  ((e.target as HTMLButtonElement).style.background = '#f3f2f1')
                }
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.6 3.4h1.2v4l3.2 1.9-.6 1L7.4 9V4.4z" />
                </svg>
                Reload Page
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
