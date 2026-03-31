# ADR 001: Use SPFx Web Part over Direct iframe Embedding

## Status

Accepted

## Date

2026-02-15

## Context

We need to embed Power BI reports in SharePoint Online pages. There are three primary approaches:

1. **Direct iframe embedding** -- Use Power BI's "Publish to web" or "Embed in SharePoint Online" option, which generates an iframe URL pasted directly into an Embed web part.
2. **Power BI web part (first-party)** -- Microsoft's built-in Power BI web part available in SharePoint Online.
3. **Custom SPFx web part with `powerbi-client`** -- A SharePoint Framework solution that acquires an AAD token and uses the `powerbi-client` JavaScript SDK to embed reports programmatically.

### Evaluation Criteria

| Criterion | iframe | First-party WP | Custom SPFx |
|---|---|---|---|
| Authentication | Anonymous or embed token | Automatic (user context) | AAD token (user-owns-data) |
| Dynamic filtering | URL params only | Limited | Full API (filters, slicers, bookmarks) |
| SharePoint integration | None | Basic | Deep (property pane, URL params, theming) |
| Customisation | None | None | Full control |
| Token management | Manual / none | Managed | Custom (cache + refresh) |
| RLS enforcement | Requires embed token | Automatic | Automatic (user identity) |
| Error handling | Generic iframe errors | Basic | Custom error boundaries, retry logic |
| Telemetry | None | None | Custom events, connection state |

### Risks of iframe Approach

- "Publish to web" links are **publicly accessible** and cannot enforce row-level security. This is a non-starter for any data containing PII, financial metrics, or internal operations data.
- URL-parameter filtering is fragile; changes to the report schema silently break filters with no error feedback.
- No ability to detect token expiry, connection loss, or report load failures. The iframe is a black box.

### Risks of First-Party Web Part

- No property pane extensions: we cannot add custom fields like "default filter values" or "auto-refresh interval."
- No programmatic access to the report object model, so we cannot implement bookmarks, print-to-PDF, or event-driven filter synchronisation between multiple web parts on the same page.

## Decision

We will build a **custom SPFx web part** using the `powerbi-client` JavaScript SDK (v2.23.x) and the `@microsoft/sp-http` AAD token provider.

### Key Implementation Details

- **Token acquisition**: Use `AadTokenProviderFactory` to acquire tokens scoped to `https://analysis.windows.net/powerbi/api`. Cache tokens client-side with a 55-minute refresh cycle (see [ADR 003](003-token-caching-strategy.md)).
- **Embedding**: Use `powerbi.embed()` with `models.TokenType.Aad` and `models.Permissions.Read`.
- **Filtering**: Parse URL query parameters (`?pbi_Table_Column=value`) and translate them to `models.IBasicFilter` objects at embed time.
- **Error handling**: Wrap rendering in a React error boundary with retry logic and structured error logging.
- **Security**: Tokens are scoped to the authenticated user's identity, so row-level security is automatically enforced by the Power BI service.

## Consequences

### Benefits

- **Security**: AAD user tokens enforce RLS and workspace-level permissions without any additional configuration. No publicly accessible embed URLs.
- **Dynamic filtering**: Full programmatic control over filters, slicers, bookmarks, and page navigation via the `powerbi-client` SDK.
- **Deep SharePoint integration**: Property pane configuration, URL parameter parsing, theme awareness, and support for SharePoint pages, Teams tabs, and Teams personal apps.
- **Observability**: Custom connection state tracking, token expiry countdown, auto-reconnect with exponential backoff, and structured error logging.
- **Extensibility**: Future features (multi-report tabs, snapshot capture, cross-web-part filter sync) require only component-level changes, not a new embedding strategy.

### Trade-offs

- **Development overhead**: Requires SPFx development experience, AAD app registration, and tenant App Catalog deployment. This is significantly more complex than pasting an iframe URL.
- **Maintenance burden**: We own the token lifecycle, error recovery, and SDK version upgrades. Microsoft's first-party web part gets these "for free."
- **App registration dependency**: The AAD app registration must be maintained. Expired secrets or revoked API permissions will break embedding for all users.
- **Testing complexity**: The web part requires a SharePoint context for integration testing. Local development uses the SharePoint Workbench, which does not perfectly replicate production behaviour.

### Mitigations

- Health check scripts (`Test-PowerBIEmbedConfig.ps1`) validate the app registration, API permissions, and token acquisition on a schedule.
- Power Automate flows alert on configuration drift or token failures.
- The error boundary component provides actionable troubleshooting guidance directly in the UI.
