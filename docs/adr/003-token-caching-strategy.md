# ADR 003: Client-Side AAD Token Caching with Refresh

## Status

Accepted

## Date

2026-02-20

## Context

The SPFx web part acquires an Azure AD access token scoped to `https://analysis.windows.net/powerbi/api` each time a user loads the SharePoint page. This token is required by the `powerbi-client` SDK to embed reports.

### The Problem

Without caching, the web part calls `AadTokenProviderFactory.getTokenProvider().getToken()` on every component mount. This is problematic because:

1. **Latency**: Token acquisition adds 200-800ms to the initial render, depending on network conditions and whether the user has an active AAD session.
2. **Rate limiting**: Azure AD enforces per-user and per-app token request limits. High-traffic SharePoint pages (e.g., a department home page with a Power BI dashboard) can trigger throttling, resulting in `429 Too Many Requests` errors.
3. **User experience**: Without proactive refresh, the embedded report will fail when the token expires (default 60 minutes), requiring a full page reload.

### Token Lifecycle

```
0 min    ──────────────── 55 min ─────── 60 min
 |  Token valid             |  Refresh     |  Token expired
 |  (serve from cache)      |  window      |  (report fails)
 └──────────────────────────┴──────────────┘
```

AAD access tokens have a default lifetime of 60-75 minutes (configurable via Conditional Access policies, but 60 minutes is the common floor). The `powerbi-client` SDK fires a `tokenExpired` event when the embedded report's token expires, but by then the report has already stopped responding to interactions.

### Options Evaluated

1. **No caching (acquire on every mount)**: Simple but slow and rate-limit-prone.
2. **Session storage caching**: Persists across in-tab navigations but is cleared on tab close. No background refresh.
3. **In-memory cache with proactive refresh**: Token cached in a singleton service, background timer refreshes at 55 minutes, `powerbi-client`'s `report.setAccessToken()` updates the embedded report seamlessly.
4. **Service-worker caching**: More robust, but SPFx does not support service worker registration in the web part lifecycle.

## Decision

We will implement **in-memory caching with a 55-minute proactive refresh cycle** in a singleton `PowerBIService` class.

### Implementation Details

```typescript
class PowerBIService {
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return this.cachedToken;
    }
    return this.acquireAndCacheToken();
  }

  private async acquireAndCacheToken(): Promise<string> {
    const token = await this.tokenProvider.getToken(POWER_BI_RESOURCE_URI);
    this.cachedToken = token;
    this.tokenExpiresAt = Date.now() + TOKEN_LIFETIME_MS;
    this.scheduleRefresh();
    return token;
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(
      () => this.acquireAndCacheToken(),
      TOKEN_REFRESH_BUFFER_MS
    );
  }
}
```

### Constants

| Constant | Value | Rationale |
|---|---|---|
| `TOKEN_LIFETIME_MS` | 3,600,000 (60 min) | Conservative AAD token lifetime |
| `TOKEN_REFRESH_BUFFER_MS` | 3,300,000 (55 min) | Refresh 5 minutes before expiry |
| `TOKEN_REFRESH_RETRY_MS` | 30,000 (30 sec) | Retry interval on refresh failure |
| `MAX_REFRESH_RETRIES` | 3 | Maximum retry attempts before emitting error |

### Refresh Failure Handling

If the proactive refresh fails (e.g., network loss, AAD outage):

1. Retry up to `MAX_REFRESH_RETRIES` times with 30-second intervals.
2. Emit a `tokenRefreshFailed` event so the `ConnectionStatus` component can show a warning.
3. Continue serving the cached token until it actually expires.
4. On actual expiry, the `powerbi-client` SDK fires `tokenExpired`, and the error boundary prompts the user to reload.

## Consequences

### Benefits

- **Faster subsequent renders**: Token is served from memory in <1ms after the first acquisition. Page-to-page navigation within the same SharePoint site reuses the cached token.
- **No rate limiting**: One token request per 55-minute window per user, well within AAD's rate limits even for high-traffic pages.
- **Seamless refresh**: The embedded report's token is updated in the background via `report.setAccessToken()`. Users never see an expiry interruption during normal usage.
- **Observability**: The `ConnectionStatus` component shows token expiry countdown and refresh state, giving users confidence that the dashboard is live.

### Trade-offs

- **Memory-only persistence**: If the user closes the tab and reopens the page within the token's validity window, a new token request is made. Session storage would avoid this, but adds complexity (serialisation, tamper risk, stale token edge cases).
- **Single-tab scope**: Each browser tab maintains its own token cache. Users with multiple tabs open to the same dashboard will each acquire separate tokens. This is acceptable given AAD's rate limits.
- **Timer cleanup**: The refresh timer must be cleared on web part disposal to prevent memory leaks and orphaned token requests. The singleton's `dispose()` method handles this.

### Mitigations

- The `PowerBIService.dispose()` method clears all timers and nullifies the cached token.
- The `ErrorBoundary` component catches and displays token-related errors with actionable retry options.
- Health check script `Test-PowerBIEmbedConfig.ps1` validates that the app registration and API permissions are correctly configured, reducing the likelihood of refresh failures.
