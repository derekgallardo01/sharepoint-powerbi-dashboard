import { WebPartContext } from '@microsoft/sp-webpart-base';

/**
 * Props passed from the web part to the React component.
 */
export interface IPowerBiDashboardProps {
  /** Power BI report GUID */
  reportId: string;
  /** Power BI workspace (group) GUID */
  workspaceId: string;
  /** Optional override for the embed URL */
  embedUrl: string;
  /** Whether the filter pane is visible in the embedded report */
  filterPaneEnabled: boolean;
  /** Whether the page navigation pane is visible */
  navContentPaneEnabled: boolean;
  /** SPFx web part context for accessing AAD token provider and other services */
  context: WebPartContext;
  /** The web part's DOM element, used for sizing the embed container */
  domElement: HTMLElement;
  /** Callback to open the property pane for configuration */
  onConfigure: () => void;
}

/**
 * Internal state for the Power BI Dashboard component.
 */
export interface IPowerBiDashboardState {
  /** Whether the report is currently loading */
  isLoading: boolean;
  /** Error message if embedding fails */
  error: string | null;
  /** Connection status for the status indicator */
  connectionStatus: ConnectionStatus;
  /** The currently active page name in the embedded report */
  activePageName: string;
  /** Timestamp of the last successful embed or refresh */
  lastRefreshed: Date | null;
}

/**
 * Enum representing the connection status to the Power BI service.
 */
export enum ConnectionStatus {
  Disconnected = 'Disconnected',
  Connecting = 'Connecting',
  Connected = 'Connected',
  Error = 'Error'
}
