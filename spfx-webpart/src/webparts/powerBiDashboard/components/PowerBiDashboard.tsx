import * as React from 'react';
import * as pbi from 'powerbi-client';
import styles from './PowerBiDashboard.module.scss';
import {
  IPowerBiDashboardProps,
  IPowerBiDashboardState,
  ConnectionStatus
} from './IPowerBiDashboardProps';

/** Power BI REST API resource URI used to acquire an AAD token. */
const POWER_BI_RESOURCE = 'https://analysis.windows.net/powerbi/api';

/** Default base URL for Power BI report embedding. */
const POWER_BI_EMBED_BASE = 'https://app.powerbi.com/reportEmbed';

/**
 * PowerBiDashboard React component.
 *
 * Embeds a Power BI report inside a SharePoint page using the powerbi-client
 * library. Handles token acquisition via SPFx AADTokenProvider, dynamic
 * filtering through URL query-string parameters, and exposes a connection
 * status indicator with manual refresh.
 */
export default class PowerBiDashboard extends React.Component<
  IPowerBiDashboardProps,
  IPowerBiDashboardState
> {
  /** Reference to the DOM element that hosts the embedded report. */
  private embedContainerRef: React.RefObject<HTMLDivElement>;

  /** powerbi-client service instance shared across embed calls. */
  private powerbiService: pbi.service.Service;

  /** Handle to the currently embedded report (if any). */
  private embeddedReport: pbi.Report | null = null;

  constructor(props: IPowerBiDashboardProps) {
    super(props);

    this.embedContainerRef = React.createRef<HTMLDivElement>();

    this.powerbiService = new pbi.service.Service(
      pbi.factories.hpmFactory,
      pbi.factories.wpmpFactory,
      pbi.factories.routerFactory
    );

    this.state = {
      isLoading: false,
      error: null,
      connectionStatus: ConnectionStatus.Disconnected,
      activePageName: '',
      lastRefreshed: null
    };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  public componentDidMount(): void {
    if (this.isConfigured()) {
      this.embedReport();
    }
  }

  public componentDidUpdate(prevProps: IPowerBiDashboardProps): void {
    const propsChanged =
      prevProps.reportId !== this.props.reportId ||
      prevProps.workspaceId !== this.props.workspaceId ||
      prevProps.embedUrl !== this.props.embedUrl ||
      prevProps.filterPaneEnabled !== this.props.filterPaneEnabled ||
      prevProps.navContentPaneEnabled !== this.props.navContentPaneEnabled;

    if (propsChanged && this.isConfigured()) {
      this.embedReport();
    }
  }

  public componentWillUnmount(): void {
    this.resetEmbed();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Returns true when the minimum required properties have been supplied. */
  private isConfigured(): boolean {
    return !!(this.props.reportId && this.props.workspaceId);
  }

  /** Builds the embed URL from props, falling back to the standard pattern. */
  private getEmbedUrl(): string {
    if (this.props.embedUrl) {
      return this.props.embedUrl;
    }
    return `${POWER_BI_EMBED_BASE}?reportId=${this.props.reportId}&groupId=${this.props.workspaceId}`;
  }

  /** Reads URL query-string parameters and converts them into Power BI filters. */
  private getFiltersFromUrl(): pbi.models.IBasicFilter[] {
    const filters: pbi.models.IBasicFilter[] = [];

    try {
      const params = new URLSearchParams(window.location.search);
      params.forEach((value, key) => {
        // Convention: filter params use the format "pbi_Table_Column=value"
        if (key.startsWith('pbi_')) {
          const parts = key.substring(4).split('_');
          if (parts.length >= 2) {
            const table = parts[0];
            const column = parts.slice(1).join('_');
            filters.push({
              $schema: 'http://powerbi.com/product/schema#basic',
              target: { table, column },
              operator: 'In' as pbi.models.BasicFilterOperators,
              values: value.split(','),
              filterType: pbi.models.FilterType.Basic
            });
          }
        }
      });
    } catch {
      // Silently ignore – filters are optional enhancements.
    }

    return filters;
  }

  /** Tears down the current embedded report, if any. */
  private resetEmbed(): void {
    if (this.embedContainerRef.current) {
      this.powerbiService.reset(this.embedContainerRef.current);
    }
    this.embeddedReport = null;
  }

  // ---------------------------------------------------------------------------
  // Core embedding logic
  // ---------------------------------------------------------------------------

  /**
   * Acquires an AAD token via the SPFx context, then embeds the Power BI
   * report in the container element.
   */
  private async embedReport(): Promise<void> {
    this.setState({
      isLoading: true,
      error: null,
      connectionStatus: ConnectionStatus.Connecting
    });

    try {
      // 1. Acquire token through SPFx AADTokenProvider
      const tokenProvider = await this.props.context.aadTokenProviderFactory.getTokenProvider();
      const accessToken = await tokenProvider.getToken(POWER_BI_RESOURCE);

      if (!accessToken) {
        throw new Error(
          'Failed to acquire a Power BI access token. Ensure the API permission ' +
          '"https://analysis.windows.net/powerbi/api/.default" has been approved ' +
          'in the SharePoint admin centre.'
        );
      }

      // 2. Build embed configuration
      const embedUrl = this.getEmbedUrl();
      const urlFilters = this.getFiltersFromUrl();

      const embedConfig: pbi.IEmbedConfiguration = {
        type: 'report',
        id: this.props.reportId,
        embedUrl: embedUrl,
        accessToken: accessToken,
        tokenType: pbi.models.TokenType.Aad,
        permissions: pbi.models.Permissions.Read,
        settings: {
          panes: {
            filters: { expanded: false, visible: this.props.filterPaneEnabled },
            pageNavigation: { visible: this.props.navContentPaneEnabled }
          },
          background: pbi.models.BackgroundType.Transparent,
          layoutType: pbi.models.LayoutType.Custom,
          customLayout: {
            displayOption: pbi.models.DisplayOption.FitToWidth
          }
        },
        filters: urlFilters.length > 0 ? urlFilters : undefined
      };

      // 3. Reset previous embed and create a new one
      this.resetEmbed();

      if (!this.embedContainerRef.current) {
        throw new Error('Embed container element is not available.');
      }

      const report = this.powerbiService.embed(
        this.embedContainerRef.current,
        embedConfig
      ) as pbi.Report;

      this.embeddedReport = report;

      // 4. Register event handlers
      report.on('loaded', () => {
        this.setState({
          isLoading: false,
          connectionStatus: ConnectionStatus.Connected,
          lastRefreshed: new Date()
        });
      });

      report.on('pageChanged', (event: pbi.service.ICustomEvent<pbi.models.IPage>) => {
        if (event.detail?.displayName) {
          this.setState({ activePageName: event.detail.displayName });
        }
      });

      report.on('error', (event: pbi.service.ICustomEvent<pbi.models.IError>) => {
        const message = event.detail?.message || 'An unknown Power BI error occurred.';
        console.error('[PowerBiDashboard] Report error:', message);
        this.setState({
          error: message,
          connectionStatus: ConnectionStatus.Error,
          isLoading: false
        });
      });

    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred while embedding the report.';
      console.error('[PowerBiDashboard] Embed failure:', message);
      this.setState({
        isLoading: false,
        error: message,
        connectionStatus: ConnectionStatus.Error
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /** Re-embeds the report, effectively refreshing the view and token. */
  private handleRefresh = async (): Promise<void> => {
    if (this.embeddedReport) {
      try {
        await this.embeddedReport.refresh();
        this.setState({ lastRefreshed: new Date() });
      } catch {
        // If in-place refresh fails, fall back to full re-embed
        await this.embedReport();
      }
    } else {
      await this.embedReport();
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  /** Renders a placeholder when the web part has not been configured. */
  private renderPlaceholder(): React.ReactElement {
    return (
      <div className={styles.placeholder}>
        <div className={styles.placeholderIcon}>
          <span className="ms-Icon ms-Icon--AreaChart" aria-hidden="true" />
        </div>
        <h2 className={styles.placeholderTitle}>Power BI Dashboard</h2>
        <p className={styles.placeholderDescription}>
          Configure this web part to display a Power BI report. You need to
          provide a Workspace ID and Report ID at minimum.
        </p>
        <button
          className={styles.configureButton}
          onClick={this.props.onConfigure}
        >
          Configure
        </button>
      </div>
    );
  }

  /** Renders the connection status badge. */
  private renderStatusIndicator(): React.ReactElement {
    const { connectionStatus, lastRefreshed } = this.state;

    const statusClass =
      connectionStatus === ConnectionStatus.Connected
        ? styles.statusConnected
        : connectionStatus === ConnectionStatus.Connecting
        ? styles.statusConnecting
        : connectionStatus === ConnectionStatus.Error
        ? styles.statusError
        : styles.statusDisconnected;

    return (
      <div className={styles.statusBar}>
        <span className={`${styles.statusDot} ${statusClass}`} />
        <span className={styles.statusText}>{connectionStatus}</span>
        {lastRefreshed && (
          <span className={styles.lastRefreshed}>
            Last refreshed: {lastRefreshed.toLocaleTimeString()}
          </span>
        )}
        <button
          className={styles.refreshButton}
          onClick={this.handleRefresh}
          title="Refresh report"
          disabled={this.state.isLoading}
        >
          &#x21bb; Refresh
        </button>
      </div>
    );
  }

  public render(): React.ReactElement<IPowerBiDashboardProps> {
    // Show placeholder when not configured
    if (!this.isConfigured()) {
      return this.renderPlaceholder();
    }

    const { isLoading, error } = this.state;

    return (
      <div className={styles.powerBiDashboard}>
        {/* Status bar */}
        {this.renderStatusIndicator()}

        {/* Error banner */}
        {error && (
          <div className={styles.errorBanner} role="alert">
            <strong>Error:</strong> {error}
            <button
              className={styles.dismissButton}
              onClick={() => this.setState({ error: null })}
              aria-label="Dismiss error"
            >
              &times;
            </button>
          </div>
        )}

        {/* Loading overlay */}
        {isLoading && (
          <div className={styles.loadingOverlay}>
            <div className={styles.spinner} />
            <p>Loading Power BI report&hellip;</p>
          </div>
        )}

        {/* Embed container */}
        <div
          ref={this.embedContainerRef}
          className={styles.embedContainer}
          aria-label="Power BI Report"
        />
      </div>
    );
  }
}
