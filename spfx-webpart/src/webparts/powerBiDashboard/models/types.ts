/**
 * Comprehensive TypeScript types for the Power BI Dashboard web part.
 *
 * Includes branded types, discriminated unions, type guards, and utility types
 * that enforce correctness at compile time.
 */

// ─── Branded Types ──────────────────────────────────────────────────────────
// Branded types prevent accidental misuse of string IDs.  You cannot pass a
// WorkspaceId where a ReportId is expected, even though both are strings at
// runtime.

declare const __brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [__brand]: B };

/** A Power BI report GUID (e.g. "a1b2c3d4-..."). */
export type ReportId = Brand<string, 'ReportId'>;

/** A Power BI workspace (group) GUID. */
export type WorkspaceId = Brand<string, 'WorkspaceId'>;

/** A Power BI dataset GUID. */
export type DatasetId = Brand<string, 'DatasetId'>;

/** An Azure AD tenant GUID or domain. */
export type TenantId = Brand<string, 'TenantId'>;

/** An Azure AD app registration client ID. */
export type ClientId = Brand<string, 'ClientId'>;

/** Millisecond timestamp. */
export type Timestamp = Brand<number, 'Timestamp'>;

// ─── Brand Constructors ─────────────────────────────────────────────────────

const GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toReportId(value: string): ReportId {
  if (!GUID_REGEX.test(value)) {
    throw new PowerBIConfigError(`Invalid Report ID: "${value}" is not a valid GUID`);
  }
  return value as ReportId;
}

export function toWorkspaceId(value: string): WorkspaceId {
  if (!GUID_REGEX.test(value)) {
    throw new PowerBIConfigError(`Invalid Workspace ID: "${value}" is not a valid GUID`);
  }
  return value as WorkspaceId;
}

export function toDatasetId(value: string): DatasetId {
  if (!GUID_REGEX.test(value)) {
    throw new PowerBIConfigError(`Invalid Dataset ID: "${value}" is not a valid GUID`);
  }
  return value as DatasetId;
}

// ─── Enums ──────────────────────────────────────────────────────────────────

/** Power BI filter operator types. */
export const enum FilterOperator {
  In = 'In',
  NotIn = 'NotIn',
  All = 'All',
  LessThan = 'LessThan',
  LessThanOrEqual = 'LessThanOrEqual',
  GreaterThan = 'GreaterThan',
  GreaterThanOrEqual = 'GreaterThanOrEqual',
  Between = 'Between',
  Contains = 'Contains',
  StartsWith = 'StartsWith',
}

/** Connection lifecycle states. */
export const enum ConnectionState {
  Idle = 'Idle',
  Connecting = 'Connecting',
  Connected = 'Connected',
  Disconnected = 'Disconnected',
  Reconnecting = 'Reconnecting',
  TokenExpired = 'TokenExpired',
  Error = 'Error',
}

/** Report embed lifecycle states (discriminated union tag). */
export const enum ReportStateKind {
  Loading = 'Loading',
  Ready = 'Ready',
  Error = 'Error',
  Refreshing = 'Refreshing',
}

/** Health check result severity. */
export const enum HealthSeverity {
  Pass = 'Pass',
  Warning = 'Warning',
  Fail = 'Fail',
}

// ─── Discriminated Unions ───────────────────────────────────────────────────

export interface ReportLoading {
  readonly kind: ReportStateKind.Loading;
  readonly message: string;
}

export interface ReportReady {
  readonly kind: ReportStateKind.Ready;
  readonly reportId: ReportId;
  readonly embedUrl: string;
  readonly datasetId: DatasetId;
  readonly loadedAt: Timestamp;
}

export interface ReportError {
  readonly kind: ReportStateKind.Error;
  readonly error: PowerBIError;
  readonly retryCount: number;
}

export interface ReportRefreshing {
  readonly kind: ReportStateKind.Refreshing;
  readonly previousState: ReportReady;
  readonly reason: 'token-refresh' | 'manual' | 'auto';
}

/** All possible report states.  Use the `kind` discriminant for narrowing. */
export type ReportState =
  | ReportLoading
  | ReportReady
  | ReportError
  | ReportRefreshing;

// ─── Error Types ────────────────────────────────────────────────────────────

export class PowerBIError extends Error {
  public readonly timestamp: Date;

  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PowerBIError';
    this.timestamp = new Date();
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PowerBIAuthError extends PowerBIError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'AUTH_ERROR', details);
    this.name = 'PowerBIAuthError';
  }
}

export class PowerBIEmbedError extends PowerBIError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'EMBED_ERROR', details);
    this.name = 'PowerBIEmbedError';
  }
}

export class PowerBIConfigError extends PowerBIError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFIG_ERROR', details);
    this.name = 'PowerBIConfigError';
  }
}

// ─── Type Guards ────────────────────────────────────────────────────────────

export function isReportReady(state: ReportState): state is ReportReady {
  return state.kind === ReportStateKind.Ready;
}

export function isReportError(state: ReportState): state is ReportError {
  return state.kind === ReportStateKind.Error;
}

export function isReportLoading(state: ReportState): state is ReportLoading {
  return state.kind === ReportStateKind.Loading;
}

export function isReportRefreshing(state: ReportState): state is ReportRefreshing {
  return state.kind === ReportStateKind.Refreshing;
}

export function isPowerBIError(error: unknown): error is PowerBIError {
  return error instanceof PowerBIError;
}

export function isPowerBIAuthError(error: unknown): error is PowerBIAuthError {
  return error instanceof PowerBIAuthError;
}

// ─── Configuration Interfaces ───────────────────────────────────────────────

export interface PowerBIEmbedConfig {
  readonly reportId: ReportId;
  readonly workspaceId: WorkspaceId;
  readonly embedUrl: string;
  readonly accessToken: string;
  readonly tokenType: 'Aad' | 'Embed';
  readonly permissions: 'Read' | 'ReadWrite' | 'Create' | 'All';
  readonly settings: EmbedSettings;
  readonly filters?: ReadonlyArray<ReportFilter>;
}

export interface EmbedSettings {
  readonly filterPaneEnabled: boolean;
  readonly navContentPaneEnabled: boolean;
  readonly background: 'Default' | 'Transparent';
  readonly layoutType: 'Master' | 'MobilePortrait' | 'MobileLandscape' | 'Custom';
}

export interface ReportFilter {
  readonly table: string;
  readonly column: string;
  readonly operator: FilterOperator;
  readonly values: ReadonlyArray<string | number | boolean>;
}

export interface WebPartConfig {
  readonly workspaceId: string;
  readonly reportId: string;
  readonly embedUrl: string;
  readonly showFilterPane: boolean;
  readonly showPageNavigation: boolean;
  readonly autoRefreshInterval: number;
}

// ─── Event Types ────────────────────────────────────────────────────────────

export interface ConnectionStateChangeEvent {
  readonly previousState: ConnectionState;
  readonly currentState: ConnectionState;
  readonly timestamp: Timestamp;
  readonly reason?: string;
}

export interface TokenRefreshEvent {
  readonly success: boolean;
  readonly timestamp: Timestamp;
  readonly expiresAt: Timestamp;
  readonly retryCount: number;
}

export interface EmbedErrorEvent {
  readonly error: PowerBIError;
  readonly reportId: ReportId;
  readonly timestamp: Timestamp;
}

export type PowerBIServiceEvent =
  | { type: 'connectionStateChange'; payload: ConnectionStateChangeEvent }
  | { type: 'tokenRefresh'; payload: TokenRefreshEvent }
  | { type: 'embedError'; payload: EmbedErrorEvent };

// ─── Utility Types ──────────────────────────────────────────────────────────

/**
 * Recursively makes all properties optional, including nested objects.
 * Useful for partial configuration updates and test fixtures.
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * Removes `readonly` modifier from all properties.
 * Useful for building objects incrementally in factory functions.
 */
export type Mutable<T> = {
  -readonly [K in keyof T]: T[K];
};

/**
 * Recursively removes `readonly` modifier.
 */
export type DeepMutable<T> = {
  -readonly [K in keyof T]: T[K] extends object ? DeepMutable<T[K]> : T[K];
};

/**
 * Extracts the payload type from a discriminated union event by its `type` tag.
 */
export type EventPayload<
  E extends PowerBIServiceEvent,
  T extends E['type'],
> = Extract<E, { type: T }>['payload'];

/**
 * Makes specific keys required while keeping the rest unchanged.
 */
export type RequireKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;

/**
 * Ensures at least one property from a set of keys is present.
 */
export type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = Pick<
  T,
  Exclude<keyof T, Keys>
> &
  {
    [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>>;
  }[Keys];

// ─── Health Check Types ─────────────────────────────────────────────────────

export interface HealthCheckResult {
  readonly checkName: string;
  readonly severity: HealthSeverity;
  readonly message: string;
  readonly details?: string;
  readonly recommendation?: string;
  readonly timestamp: Date;
}

export interface HealthReport {
  readonly results: ReadonlyArray<HealthCheckResult>;
  readonly overallSeverity: HealthSeverity;
  readonly generatedAt: Date;
  readonly environment: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly reportId: string;
  };
}

// ─── Validation Types ───────────────────────────────────────────────────────

export interface ValidationError {
  readonly field: string;
  readonly message: string;
  readonly value?: unknown;
}

export interface ValidationResult {
  readonly isValid: boolean;
  readonly errors: ReadonlyArray<ValidationError>;
}
