/**
 * PowerBIService -- Singleton service for Power BI embedding operations.
 *
 * Features:
 * - Singleton lifecycle management
 * - AAD token acquisition with caching and proactive refresh
 * - Generic retry logic with exponential backoff
 * - Type-safe event emitter for connection state changes
 * - Configuration builder pattern
 * - Proper disposal and cleanup
 */

import {
  type ReportId,
  type WorkspaceId,
  type DatasetId,
  type Timestamp,
  type PowerBIEmbedConfig,
  type EmbedSettings,
  type ReportFilter,
  type ConnectionStateChangeEvent,
  type TokenRefreshEvent,
  type ReportState,
  ConnectionState,
  ReportStateKind,
  PowerBIAuthError,
  PowerBIEmbedError,
  PowerBIConfigError,
  toReportId,
  toWorkspaceId,
} from '../models/types';

// ─── Constants ──────────────────────────────────────────────────────────────

const POWER_BI_RESOURCE_URI = 'https://analysis.windows.net/powerbi/api';
const POWER_BI_API_BASE = 'https://api.powerbi.com/v1.0/myorg';
const TOKEN_LIFETIME_MS = 3_600_000;       // 60 minutes
const TOKEN_REFRESH_BUFFER_MS = 3_300_000; // 55 minutes (refresh 5 min early)
const TOKEN_REFRESH_RETRY_MS = 30_000;     // 30 seconds
const MAX_REFRESH_RETRIES = 3;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 30_000;

// ─── Event Emitter ──────────────────────────────────────────────────────────

type EventMap = {
  connectionStateChange: ConnectionStateChangeEvent;
  tokenRefresh: TokenRefreshEvent;
  reportStateChange: ReportState;
  error: Error;
};

type EventHandler<T> = (payload: T) => void;

class TypedEventEmitter {
  private handlers: {
    [K in keyof EventMap]?: Set<EventHandler<EventMap[K]>>;
  } = {};

  public on<K extends keyof EventMap>(
    event: K,
    handler: EventHandler<EventMap[K]>,
  ): () => void {
    if (!this.handlers[event]) {
      this.handlers[event] = new Set();
    }
    (this.handlers[event] as Set<EventHandler<EventMap[K]>>).add(handler);

    // Return unsubscribe function
    return () => {
      (this.handlers[event] as Set<EventHandler<EventMap[K]>>)?.delete(handler);
    };
  }

  public emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const eventHandlers = this.handlers[event] as
      | Set<EventHandler<EventMap[K]>>
      | undefined;
    if (eventHandlers) {
      for (const handler of eventHandlers) {
        try {
          handler(payload);
        } catch (err) {
          console.error(`[PowerBIService] Event handler error for "${event}":`, err);
        }
      }
    }
  }

  public removeAllListeners(): void {
    for (const key of Object.keys(this.handlers)) {
      delete this.handlers[key as keyof EventMap];
    }
  }
}

// ─── Retry Logic ────────────────────────────────────────────────────────────

interface RetryOptions {
  /** Maximum number of attempts (including the initial call). */
  maxAttempts: number;
  /** Base delay in milliseconds. Doubled on each retry. */
  baseDelayMs: number;
  /** Maximum delay cap in milliseconds. */
  maxDelayMs: number;
  /** Optional predicate to decide whether to retry a specific error. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Optional callback invoked before each retry. */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Executes an async function with exponential backoff retry.
 *
 * @typeParam T - The return type of the function being retried.
 * @param fn - The async function to execute.
 * @param options - Retry configuration.
 * @returns The result of the function on success.
 * @throws The last error if all retry attempts are exhausted.
 */
async function retryAsync<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const {
    maxAttempts = DEFAULT_RETRY_ATTEMPTS,
    baseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS,
    shouldRetry = () => true,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts || !shouldRetry(error, attempt)) {
        throw error;
      }

      // Exponential backoff with jitter
      const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = Math.random() * baseDelayMs * 0.5;
      const delayMs = Math.min(exponentialDelay + jitter, maxDelayMs);

      onRetry?.(error, attempt, delayMs);

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // TypeScript flow analysis: this is unreachable, but satisfies the compiler
  throw lastError;
}

// ─── Configuration Builder ──────────────────────────────────────────────────

/**
 * Fluent builder for constructing a PowerBIEmbedConfig.
 *
 * Usage:
 * ```ts
 * const config = new EmbedConfigBuilder()
 *   .setReport('guid-here', 'guid-here')
 *   .setEmbedUrl('https://app.powerbi.com/...')
 *   .setAccessToken(token)
 *   .addFilter('Sales', 'Region', FilterOperator.In, ['West'])
 *   .enableFilterPane()
 *   .build();
 * ```
 */
export class EmbedConfigBuilder {
  private reportId: ReportId | null = null;
  private workspaceId: WorkspaceId | null = null;
  private embedUrl: string = '';
  private accessToken: string = '';
  private tokenType: 'Aad' | 'Embed' = 'Aad';
  private permissions: 'Read' | 'ReadWrite' | 'Create' | 'All' = 'Read';
  private settings: EmbedSettings = {
    filterPaneEnabled: false,
    navContentPaneEnabled: true,
    background: 'Transparent',
    layoutType: 'Master',
  };
  private filters: ReportFilter[] = [];

  public setReport(reportId: string, workspaceId: string): this {
    this.reportId = toReportId(reportId);
    this.workspaceId = toWorkspaceId(workspaceId);
    return this;
  }

  public setEmbedUrl(url: string): this {
    this.embedUrl = url;
    return this;
  }

  public setAccessToken(token: string, type: 'Aad' | 'Embed' = 'Aad'): this {
    this.accessToken = token;
    this.tokenType = type;
    return this;
  }

  public setPermissions(permissions: 'Read' | 'ReadWrite' | 'Create' | 'All'): this {
    this.permissions = permissions;
    return this;
  }

  public enableFilterPane(enabled: boolean = true): this {
    this.settings = { ...this.settings, filterPaneEnabled: enabled };
    return this;
  }

  public enableNavigation(enabled: boolean = true): this {
    this.settings = { ...this.settings, navContentPaneEnabled: enabled };
    return this;
  }

  public setBackground(background: 'Default' | 'Transparent'): this {
    this.settings = { ...this.settings, background };
    return this;
  }

  public setLayout(
    layoutType: 'Master' | 'MobilePortrait' | 'MobileLandscape' | 'Custom',
  ): this {
    this.settings = { ...this.settings, layoutType };
    return this;
  }

  public addFilter(
    table: string,
    column: string,
    operator: import('../models/types').FilterOperator,
    values: ReadonlyArray<string | number | boolean>,
  ): this {
    this.filters.push({ table, column, operator, values });
    return this;
  }

  public clearFilters(): this {
    this.filters = [];
    return this;
  }

  public build(): PowerBIEmbedConfig {
    if (!this.reportId) {
      throw new PowerBIConfigError('Report ID is required');
    }
    if (!this.workspaceId) {
      throw new PowerBIConfigError('Workspace ID is required');
    }
    if (!this.embedUrl) {
      throw new PowerBIConfigError('Embed URL is required');
    }
    if (!this.accessToken) {
      throw new PowerBIConfigError('Access token is required');
    }

    return {
      reportId: this.reportId,
      workspaceId: this.workspaceId,
      embedUrl: this.embedUrl,
      accessToken: this.accessToken,
      tokenType: this.tokenType,
      permissions: this.permissions,
      settings: { ...this.settings },
      filters: [...this.filters],
    };
  }
}

// ─── Token Provider Interface ───────────────────────────────────────────────

/**
 * Abstraction over the SPFx AadTokenProvider, enabling testing with mocks.
 */
export interface ITokenProvider {
  getToken(resourceUri: string): Promise<string>;
}

// ─── PowerBI Service (Singleton) ────────────────────────────────────────────

export class PowerBIService {
  // ── Singleton ──
  private static instance: PowerBIService | null = null;

  public static getInstance(): PowerBIService {
    if (!PowerBIService.instance) {
      PowerBIService.instance = new PowerBIService();
    }
    return PowerBIService.instance;
  }

  public static resetInstance(): void {
    if (PowerBIService.instance) {
      PowerBIService.instance.dispose();
      PowerBIService.instance = null;
    }
  }

  // ── State ──
  private tokenProvider: ITokenProvider | null = null;
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshRetryCount: number = 0;
  private connectionState: ConnectionState = ConnectionState.Idle;
  private disposed: boolean = false;
  private readonly emitter = new TypedEventEmitter();

  private constructor() {
    // Private constructor enforces singleton usage
  }

  // ── Initialisation ──

  /**
   * Initialise the service with an AAD token provider.
   * Must be called before any other operations.
   */
  public initialise(tokenProvider: ITokenProvider): void {
    if (this.disposed) {
      throw new PowerBIConfigError('Cannot initialise a disposed PowerBIService');
    }
    this.tokenProvider = tokenProvider;
    this.setConnectionState(ConnectionState.Idle, 'Service initialised');
  }

  // ── Token Management ──

  /**
   * Get a valid access token, serving from cache when possible.
   * Automatically triggers a refresh if the token is within the refresh buffer.
   */
  public async getAccessToken(): Promise<string> {
    this.ensureInitialised();

    // Serve from cache if still valid
    if (this.cachedToken && Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return this.cachedToken;
    }

    // Token expired or within refresh buffer -- acquire a new one
    return this.acquireAndCacheToken();
  }

  /**
   * Force a token refresh, bypassing the cache.
   */
  public async forceTokenRefresh(): Promise<string> {
    this.ensureInitialised();
    return this.acquireAndCacheToken();
  }

  /**
   * Returns the number of milliseconds until the current token expires,
   * or 0 if no token is cached.
   */
  public getTokenTTL(): number {
    if (!this.cachedToken || this.tokenExpiresAt === 0) {
      return 0;
    }
    return Math.max(0, this.tokenExpiresAt - Date.now());
  }

  private async acquireAndCacheToken(): Promise<string> {
    this.setConnectionState(ConnectionState.Connecting, 'Acquiring token');

    try {
      const token = await retryAsync(
        () => this.tokenProvider!.getToken(POWER_BI_RESOURCE_URI),
        {
          maxAttempts: MAX_REFRESH_RETRIES,
          baseDelayMs: TOKEN_REFRESH_RETRY_MS,
          shouldRetry: (error) => {
            // Do not retry auth errors that indicate permanent failure
            if (error instanceof PowerBIAuthError) return false;
            return true;
          },
          onRetry: (error, attempt, delayMs) => {
            console.warn(
              `[PowerBIService] Token acquisition retry ${attempt}/${MAX_REFRESH_RETRIES}`,
              `(next attempt in ${Math.round(delayMs / 1000)}s):`,
              error,
            );
          },
        },
      );

      this.cachedToken = token;
      this.tokenExpiresAt = Date.now() + TOKEN_LIFETIME_MS;
      this.refreshRetryCount = 0;
      this.scheduleProactiveRefresh();
      this.setConnectionState(ConnectionState.Connected, 'Token acquired');

      this.emitter.emit('tokenRefresh', {
        success: true,
        timestamp: Date.now() as Timestamp,
        expiresAt: this.tokenExpiresAt as Timestamp,
        retryCount: 0,
      });

      return token;
    } catch (error) {
      this.setConnectionState(ConnectionState.Error, 'Token acquisition failed');

      this.emitter.emit('tokenRefresh', {
        success: false,
        timestamp: Date.now() as Timestamp,
        expiresAt: 0 as Timestamp,
        retryCount: this.refreshRetryCount,
      });

      if (error instanceof Error) {
        throw new PowerBIAuthError(
          `Failed to acquire Power BI access token: ${error.message}`,
          { originalError: error.message },
        );
      }
      throw new PowerBIAuthError('Failed to acquire Power BI access token');
    }
  }

  private scheduleProactiveRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(async () => {
      if (this.disposed) return;

      try {
        await this.acquireAndCacheToken();
        console.info('[PowerBIService] Proactive token refresh succeeded');
      } catch (error) {
        this.refreshRetryCount++;
        console.error('[PowerBIService] Proactive token refresh failed:', error);

        if (this.refreshRetryCount < MAX_REFRESH_RETRIES) {
          // Schedule a retry
          this.refreshTimer = setTimeout(
            () => this.scheduleProactiveRefresh(),
            TOKEN_REFRESH_RETRY_MS,
          );
        } else {
          this.setConnectionState(
            ConnectionState.TokenExpired,
            `Token refresh failed after ${MAX_REFRESH_RETRIES} retries`,
          );
        }
      }
    }, TOKEN_REFRESH_BUFFER_MS);
  }

  // ── Report Metadata ──

  /**
   * Fetches report metadata from the Power BI REST API.
   */
  public async getReportMetadata(
    workspaceId: WorkspaceId,
    reportId: ReportId,
  ): Promise<{ embedUrl: string; datasetId: DatasetId }> {
    const token = await this.getAccessToken();
    const url = `${POWER_BI_API_BASE}/groups/${workspaceId}/reports/${reportId}`;

    const response = await retryAsync(
      async () => {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.status === 401 || res.status === 403) {
          throw new PowerBIAuthError(
            `Access denied to report ${reportId} in workspace ${workspaceId}`,
            { status: res.status },
          );
        }

        if (!res.ok) {
          throw new PowerBIEmbedError(
            `Power BI API returned ${res.status}: ${res.statusText}`,
            { status: res.status, url },
          );
        }

        return res.json();
      },
      {
        maxAttempts: 2,
        baseDelayMs: 2_000,
        shouldRetry: (error) => !(error instanceof PowerBIAuthError),
      },
    );

    return {
      embedUrl: response.embedUrl,
      datasetId: response.datasetId as DatasetId,
    };
  }

  // ── Connection State ──

  public getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  private setConnectionState(state: ConnectionState, reason?: string): void {
    const previous = this.connectionState;
    if (previous === state) return;

    this.connectionState = state;

    this.emitter.emit('connectionStateChange', {
      previousState: previous,
      currentState: state,
      timestamp: Date.now() as Timestamp,
      reason,
    });
  }

  // ── Events ──

  public on<K extends keyof EventMap>(
    event: K,
    handler: EventHandler<EventMap[K]>,
  ): () => void {
    return this.emitter.on(event, handler);
  }

  // ── Disposal ──

  /**
   * Cleans up all timers and cached state.
   * Must be called when the web part is disposed.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    this.cachedToken = null;
    this.tokenExpiresAt = 0;
    this.tokenProvider = null;
    this.emitter.removeAllListeners();

    console.info('[PowerBIService] Disposed');
  }

  public isDisposed(): boolean {
    return this.disposed;
  }

  // ── Helpers ──

  private ensureInitialised(): asserts this is this & {
    tokenProvider: ITokenProvider;
  } {
    if (this.disposed) {
      throw new PowerBIConfigError('PowerBIService has been disposed');
    }
    if (!this.tokenProvider) {
      throw new PowerBIConfigError(
        'PowerBIService has not been initialised. Call initialise(tokenProvider) first.',
      );
    }
  }
}

export default PowerBIService;
