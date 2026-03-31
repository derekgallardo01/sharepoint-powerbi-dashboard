import * as React from 'react';
import * as pbi from 'powerbi-client';
import styles from './ConnectionStatus.module.scss';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Connection states for the Power BI report embed. */
export enum ConnectionState {
  Connecting = 'Connecting',
  Connected = 'Connected',
  Disconnected = 'Disconnected',
  Reconnecting = 'Reconnecting',
}

/** Props for the ConnectionStatus component. */
export interface IConnectionStatusProps {
  /** Current connection state. */
  state: ConnectionState;
  /** Timestamp of the last successful data refresh. */
  lastRefreshed: Date | null;
  /** Token expiry time (Date). Used to display a countdown. */
  tokenExpiry: Date | null;
  /** The embedded Power BI report instance. */
  report: pbi.Report | null;
  /** Callback to request a full report re-embed (token refresh). */
  onRefresh: () => Promise<void>;
  /** Callback to request a token-only refresh. */
  onTokenRefresh: () => Promise<void>;
}

/** Internal state. */
interface IConnectionStatusState {
  /** Remaining seconds until token expiry. */
  tokenSecondsRemaining: number | null;
  /** Whether a refresh is currently in progress. */
  isRefreshing: boolean;
  /** Reconnect attempt counter. */
  reconnectAttempt: number;
  /** Current connection state (tracks prop + internal reconnect). */
  currentState: ConnectionState;
}

/** Minimum seconds at which the token expiry warning is shown. */
const TOKEN_WARNING_THRESHOLD_SECONDS = 300; // 5 minutes

/** Base delay in milliseconds for exponential backoff reconnect. */
const RECONNECT_BASE_DELAY_MS = 2000;

/** Maximum reconnect attempts before giving up. */
const MAX_RECONNECT_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Connection status indicator for Power BI embedded reports.
 *
 * Shows the current connection state with a coloured dot, provides a manual
 * refresh button, displays the last-refresh timestamp, and shows a token
 * expiry countdown that warns the user at the 5-minute mark.
 *
 * When the connection drops it automatically retries with exponential backoff.
 */
export class ConnectionStatus extends React.Component<
  IConnectionStatusProps,
  IConnectionStatusState
> {
  /** Interval handle for the token countdown ticker. */
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  /** Timeout handle for reconnect backoff. */
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(props: IConnectionStatusProps) {
    super(props);
    this.state = {
      tokenSecondsRemaining: this.computeSecondsRemaining(props.tokenExpiry),
      isRefreshing: false,
      reconnectAttempt: 0,
      currentState: props.state,
    };
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  public componentDidMount(): void {
    this.startCountdown();
  }

  public componentDidUpdate(prevProps: IConnectionStatusProps): void {
    // Sync external state changes
    if (prevProps.state !== this.props.state) {
      this.setState({ currentState: this.props.state });

      if (this.props.state === ConnectionState.Connected) {
        // Reset reconnect counter on successful connect
        this.setState({ reconnectAttempt: 0 });
      }

      if (this.props.state === ConnectionState.Disconnected) {
        this.attemptReconnect();
      }
    }

    // Restart countdown if token expiry changes
    if (prevProps.tokenExpiry !== this.props.tokenExpiry) {
      this.setState({
        tokenSecondsRemaining: this.computeSecondsRemaining(this.props.tokenExpiry),
      });
      this.startCountdown();
    }
  }

  public componentWillUnmount(): void {
    this.stopCountdown();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  // -----------------------------------------------------------------------
  // Token countdown
  // -----------------------------------------------------------------------

  private computeSecondsRemaining(expiry: Date | null): number | null {
    if (!expiry) return null;
    const diff = Math.floor((expiry.getTime() - Date.now()) / 1000);
    return diff > 0 ? diff : 0;
  }

  private startCountdown(): void {
    this.stopCountdown();
    this.countdownInterval = setInterval(() => {
      const remaining = this.computeSecondsRemaining(this.props.tokenExpiry);
      this.setState({ tokenSecondsRemaining: remaining });

      // Auto-refresh token when it expires
      if (remaining !== null && remaining <= 0) {
        this.stopCountdown();
        this.handleTokenRefresh();
      }
    }, 1000);
  }

  private stopCountdown(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  private formatCountdown(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // -----------------------------------------------------------------------
  // Reconnect with exponential backoff
  // -----------------------------------------------------------------------

  private attemptReconnect(): void {
    const { reconnectAttempt } = this.state;

    if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      console.warn(
        `[ConnectionStatus] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached.`
      );
      return;
    }

    const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempt);
    console.info(
      `[ConnectionStatus] Scheduling reconnect attempt ${reconnectAttempt + 1} in ${delay}ms`
    );

    this.setState({
      currentState: ConnectionState.Reconnecting,
      reconnectAttempt: reconnectAttempt + 1,
    });

    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.props.onRefresh();
        // If refresh succeeds, the parent will update state to Connected
      } catch (err) {
        console.error('[ConnectionStatus] Reconnect attempt failed:', err);
        // Schedule next attempt
        this.attemptReconnect();
      }
    }, delay);
  }

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  private handleManualRefresh = async (): Promise<void> => {
    this.setState({ isRefreshing: true });
    try {
      await this.props.onRefresh();
    } catch (err) {
      console.error('[ConnectionStatus] Manual refresh failed:', err);
    } finally {
      this.setState({ isRefreshing: false });
    }
  };

  private handleTokenRefresh = async (): Promise<void> => {
    try {
      await this.props.onTokenRefresh();
    } catch (err) {
      console.error('[ConnectionStatus] Token refresh failed:', err);
    }
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  /** Returns a CSS class based on the current connection state. */
  private getStatusClass(): string {
    switch (this.state.currentState) {
      case ConnectionState.Connected:
        return styles.connected;
      case ConnectionState.Connecting:
        return styles.connecting;
      case ConnectionState.Reconnecting:
        return styles.reconnecting;
      case ConnectionState.Disconnected:
      default:
        return styles.disconnected;
    }
  }

  public render(): React.ReactElement<IConnectionStatusProps> {
    const { lastRefreshed } = this.props;
    const { currentState, tokenSecondsRemaining, isRefreshing, reconnectAttempt } = this.state;

    const showTokenWarning =
      tokenSecondsRemaining !== null &&
      tokenSecondsRemaining <= TOKEN_WARNING_THRESHOLD_SECONDS &&
      tokenSecondsRemaining > 0;

    return (
      <div
        className={styles.connectionStatus}
        role="status"
        aria-live="polite"
        aria-label={`Connection status: ${currentState}`}
      >
        {/* Status indicator dot + label */}
        <span className={`${styles.statusDot} ${this.getStatusClass()}`} aria-hidden="true" />
        <span className={styles.statusLabel}>{currentState}</span>

        {/* Reconnect attempt indicator */}
        {currentState === ConnectionState.Reconnecting && (
          <span className={styles.reconnectInfo}>
            (attempt {reconnectAttempt}/{MAX_RECONNECT_ATTEMPTS})
          </span>
        )}

        {/* Token expiry countdown */}
        {tokenSecondsRemaining !== null && tokenSecondsRemaining > 0 && (
          <span
            className={`${styles.tokenCountdown} ${showTokenWarning ? styles.tokenWarning : ''}`}
            title="Time until access token expires"
          >
            Token: {this.formatCountdown(tokenSecondsRemaining)}
          </span>
        )}

        {/* Token expired notice */}
        {tokenSecondsRemaining !== null && tokenSecondsRemaining <= 0 && (
          <span className={styles.tokenExpired}>Token expired</span>
        )}

        {/* Last refreshed timestamp */}
        {lastRefreshed && (
          <span className={styles.lastRefreshed} title={lastRefreshed.toISOString()}>
            Last refreshed: {lastRefreshed.toLocaleTimeString()}
          </span>
        )}

        {/* Manual refresh button */}
        <button
          className={styles.refreshButton}
          onClick={this.handleManualRefresh}
          disabled={isRefreshing || currentState === ConnectionState.Reconnecting}
          title="Refresh report data and token"
          aria-label="Refresh report"
        >
          <span className={`${styles.refreshIcon} ${isRefreshing ? styles.spinning : ''}`}>
            &#x21bb;
          </span>
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
    );
  }
}

export default ConnectionStatus;
