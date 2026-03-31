import * as React from 'react';
import * as pbi from 'powerbi-client';
import styles from './FilterPanel.module.scss';

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

/** Supported filter control types. */
export type FilterControlType = 'basic' | 'advanced' | 'dateRange';

/** Comparison operators for advanced filters. */
export type AdvancedFilterOperator =
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'contains'
  | 'startsWith';

/** Descriptor for a single filter control rendered in the panel. */
export interface IFilterDescriptor {
  /** Unique key used for state tracking and URL serialization. */
  key: string;
  /** Display label shown above the control. */
  label: string;
  /** Power BI table name the filter targets. */
  table: string;
  /** Power BI column name the filter targets. */
  column: string;
  /** The type of filter control to render. */
  controlType: FilterControlType;
  /** Available options for basic (dropdown) filters. */
  options?: string[];
  /** Default selected value(s). */
  defaultValues?: string[];
}

/** Current value held by a single filter. */
export interface IFilterValue {
  /** Selected values for basic filters, or [startDate, endDate] for date range. */
  values: string[];
  /** Operator for advanced filters (ignored by basic / date range). */
  operator?: AdvancedFilterOperator;
}

/** Props for the FilterPanel component. */
export interface IFilterPanelProps {
  /** Array of filter descriptors that determine what controls to render. */
  filters: IFilterDescriptor[];
  /** Reference to the currently embedded Power BI report. */
  report: pbi.Report | null;
  /** Whether the panel is expanded. */
  isOpen: boolean;
  /** Callback to toggle panel visibility. */
  onToggle: () => void;
}

/** Internal state for the FilterPanel. */
interface IFilterPanelState {
  /** Map of filter key to current value. */
  filterValues: Record<string, IFilterValue>;
  /** Whether filters are currently being applied. */
  isApplying: boolean;
  /** Error message, if any. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read filter state from the current URL search params. */
function readFiltersFromUrl(descriptors: IFilterDescriptor[]): Record<string, IFilterValue> {
  const state: Record<string, IFilterValue> = {};
  try {
    const params = new URLSearchParams(window.location.search);
    for (const desc of descriptors) {
      const raw = params.get(`filter_${desc.key}`);
      const operator = params.get(`filter_${desc.key}_op`) as AdvancedFilterOperator | null;
      if (raw) {
        state[desc.key] = {
          values: raw.split(','),
          operator: operator || undefined,
        };
      } else if (desc.defaultValues && desc.defaultValues.length > 0) {
        state[desc.key] = { values: [...desc.defaultValues] };
      } else {
        state[desc.key] = { values: [] };
      }
    }
  } catch {
    // Fall back to defaults when URL parsing fails.
    for (const desc of descriptors) {
      state[desc.key] = { values: desc.defaultValues ? [...desc.defaultValues] : [] };
    }
  }
  return state;
}

/** Persist filter state into the URL without triggering a page reload. */
function writeFiltersToUrl(filterValues: Record<string, IFilterValue>): void {
  try {
    const url = new URL(window.location.href);
    // Remove existing filter params
    const keysToDelete: string[] = [];
    url.searchParams.forEach((_v, k) => {
      if (k.startsWith('filter_')) keysToDelete.push(k);
    });
    keysToDelete.forEach((k) => url.searchParams.delete(k));

    // Write active filters
    for (const [key, value] of Object.entries(filterValues)) {
      if (value.values.length > 0) {
        url.searchParams.set(`filter_${key}`, value.values.join(','));
        if (value.operator) {
          url.searchParams.set(`filter_${key}_op`, value.operator);
        }
      }
    }

    window.history.replaceState(null, '', url.toString());
  } catch {
    // Silently ignore – URL persistence is a convenience enhancement.
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Reusable filter panel component for Power BI embedded reports.
 *
 * Renders dynamic filters (basic dropdown, advanced condition, date range)
 * based on a declarative descriptor array. Filter state is persisted to URL
 * query parameters so that bookmarked links retain the active filters.
 */
export class FilterPanel extends React.Component<IFilterPanelProps, IFilterPanelState> {
  constructor(props: IFilterPanelProps) {
    super(props);
    this.state = {
      filterValues: readFiltersFromUrl(props.filters),
      isApplying: false,
      error: null,
    };
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  public componentDidUpdate(prevProps: IFilterPanelProps): void {
    if (prevProps.filters !== this.props.filters) {
      this.setState({ filterValues: readFiltersFromUrl(this.props.filters) });
    }
  }

  // -----------------------------------------------------------------------
  // Filter application
  // -----------------------------------------------------------------------

  /** Build Power BI filter models from the current state and apply them. */
  private handleApply = async (): Promise<void> => {
    const { report, filters } = this.props;
    const { filterValues } = this.state;

    if (!report) {
      this.setState({ error: 'No report is currently loaded.' });
      return;
    }

    this.setState({ isApplying: true, error: null });

    try {
      const pbiFilters: pbi.models.IFilter[] = [];

      for (const desc of filters) {
        const fv = filterValues[desc.key];
        if (!fv || fv.values.length === 0) continue;

        switch (desc.controlType) {
          case 'basic': {
            const basicFilter: pbi.models.IBasicFilter = {
              $schema: 'http://powerbi.com/product/schema#basic',
              target: { table: desc.table, column: desc.column },
              operator: 'In' as pbi.models.BasicFilterOperators,
              values: fv.values,
              filterType: pbi.models.FilterType.Basic,
            };
            pbiFilters.push(basicFilter);
            break;
          }

          case 'advanced': {
            const conditions: pbi.models.IAdvancedFilterCondition[] = fv.values.map((v) => ({
              value: v,
              operator: (fv.operator || 'equals') as pbi.models.AdvancedFilterConditionOperators,
            }));
            const advancedFilter: pbi.models.IAdvancedFilter = {
              $schema: 'http://powerbi.com/product/schema#advanced',
              target: { table: desc.table, column: desc.column },
              logicalOperator: 'And' as pbi.models.AdvancedFilterLogicalOperators,
              conditions,
              filterType: pbi.models.FilterType.Advanced,
            };
            pbiFilters.push(advancedFilter);
            break;
          }

          case 'dateRange': {
            // Expect values[0] = start ISO date, values[1] = end ISO date
            if (fv.values.length >= 2) {
              const conditions: pbi.models.IAdvancedFilterCondition[] = [
                {
                  value: fv.values[0],
                  operator: 'GreaterThanOrEqual' as pbi.models.AdvancedFilterConditionOperators,
                },
                {
                  value: fv.values[1],
                  operator: 'LessThanOrEqual' as pbi.models.AdvancedFilterConditionOperators,
                },
              ];
              const dateFilter: pbi.models.IAdvancedFilter = {
                $schema: 'http://powerbi.com/product/schema#advanced',
                target: { table: desc.table, column: desc.column },
                logicalOperator: 'And' as pbi.models.AdvancedFilterLogicalOperators,
                conditions,
                filterType: pbi.models.FilterType.Advanced,
              };
              pbiFilters.push(dateFilter);
            }
            break;
          }
        }
      }

      await report.updateFilters(pbi.models.FiltersOperations.ReplaceAll, pbiFilters);
      writeFiltersToUrl(filterValues);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to apply filters.';
      console.error('[FilterPanel] Apply failed:', message);
      this.setState({ error: message });
    } finally {
      this.setState({ isApplying: false });
    }
  };

  /** Remove all active filters from the report and reset local state. */
  private handleClear = async (): Promise<void> => {
    const { report, filters } = this.props;

    const cleared: Record<string, IFilterValue> = {};
    for (const desc of filters) {
      cleared[desc.key] = { values: [] };
    }

    this.setState({ filterValues: cleared, error: null });
    writeFiltersToUrl(cleared);

    if (report) {
      try {
        await report.updateFilters(pbi.models.FiltersOperations.RemoveAll);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to clear filters.';
        console.error('[FilterPanel] Clear failed:', message);
        this.setState({ error: message });
      }
    }
  };

  // -----------------------------------------------------------------------
  // Value change handlers
  // -----------------------------------------------------------------------

  private handleBasicChange = (key: string, selected: string[]): void => {
    this.setState((prev) => ({
      filterValues: {
        ...prev.filterValues,
        [key]: { ...prev.filterValues[key], values: selected },
      },
    }));
  };

  private handleAdvancedValueChange = (key: string, value: string): void => {
    this.setState((prev) => ({
      filterValues: {
        ...prev.filterValues,
        [key]: {
          ...prev.filterValues[key],
          values: value ? [value] : [],
        },
      },
    }));
  };

  private handleAdvancedOperatorChange = (key: string, operator: AdvancedFilterOperator): void => {
    this.setState((prev) => ({
      filterValues: {
        ...prev.filterValues,
        [key]: { ...prev.filterValues[key], operator },
      },
    }));
  };

  private handleDateChange = (key: string, index: 0 | 1, value: string): void => {
    this.setState((prev) => {
      const current = prev.filterValues[key]?.values || ['', ''];
      const updated = [...current];
      updated[index] = value;
      return {
        filterValues: {
          ...prev.filterValues,
          [key]: { ...prev.filterValues[key], values: updated },
        },
      };
    });
  };

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  private renderBasicFilter(desc: IFilterDescriptor): React.ReactElement {
    const selected = this.state.filterValues[desc.key]?.values || [];
    const options = desc.options || [];

    return (
      <div className={styles.filterControl} key={desc.key}>
        <label className={styles.filterLabel}>{desc.label}</label>
        <select
          className={styles.dropdown}
          multiple
          value={selected}
          onChange={(e) => {
            const opts = Array.from(e.target.selectedOptions, (o) => o.value);
            this.handleBasicChange(desc.key, opts);
          }}
          aria-label={desc.label}
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
    );
  }

  private renderAdvancedFilter(desc: IFilterDescriptor): React.ReactElement {
    const fv = this.state.filterValues[desc.key] || { values: [], operator: 'equals' };
    const currentValue = fv.values[0] || '';
    const currentOp = fv.operator || 'equals';

    const operators: { key: AdvancedFilterOperator; text: string }[] = [
      { key: 'equals', text: 'Equals' },
      { key: 'notEquals', text: 'Not Equals' },
      { key: 'greaterThan', text: 'Greater Than' },
      { key: 'greaterThanOrEqual', text: 'Greater Than or Equal' },
      { key: 'lessThan', text: 'Less Than' },
      { key: 'lessThanOrEqual', text: 'Less Than or Equal' },
      { key: 'contains', text: 'Contains' },
      { key: 'startsWith', text: 'Starts With' },
    ];

    return (
      <div className={styles.filterControl} key={desc.key}>
        <label className={styles.filterLabel}>{desc.label}</label>
        <div className={styles.advancedRow}>
          <select
            className={styles.operatorSelect}
            value={currentOp}
            onChange={(e) =>
              this.handleAdvancedOperatorChange(desc.key, e.target.value as AdvancedFilterOperator)
            }
            aria-label={`${desc.label} operator`}
          >
            {operators.map((op) => (
              <option key={op.key} value={op.key}>
                {op.text}
              </option>
            ))}
          </select>
          <input
            className={styles.textInput}
            type="text"
            value={currentValue}
            onChange={(e) => this.handleAdvancedValueChange(desc.key, e.target.value)}
            placeholder="Enter value..."
            aria-label={`${desc.label} value`}
          />
        </div>
      </div>
    );
  }

  private renderDateRangeFilter(desc: IFilterDescriptor): React.ReactElement {
    const fv = this.state.filterValues[desc.key] || { values: ['', ''] };
    const startDate = fv.values[0] || '';
    const endDate = fv.values[1] || '';

    return (
      <div className={styles.filterControl} key={desc.key}>
        <label className={styles.filterLabel}>{desc.label}</label>
        <div className={styles.dateRow}>
          <div className={styles.dateField}>
            <label className={styles.dateLabel}>From</label>
            <input
              className={styles.dateInput}
              type="date"
              value={startDate}
              onChange={(e) => this.handleDateChange(desc.key, 0, e.target.value)}
              aria-label={`${desc.label} start date`}
            />
          </div>
          <div className={styles.dateField}>
            <label className={styles.dateLabel}>To</label>
            <input
              className={styles.dateInput}
              type="date"
              value={endDate}
              onChange={(e) => this.handleDateChange(desc.key, 1, e.target.value)}
              aria-label={`${desc.label} end date`}
            />
          </div>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  public render(): React.ReactElement<IFilterPanelProps> {
    const { filters, isOpen, onToggle } = this.props;
    const { isApplying, error } = this.state;

    const activeCount = Object.values(this.state.filterValues).filter(
      (fv) => fv.values.length > 0 && fv.values.some(Boolean)
    ).length;

    return (
      <div className={`${styles.filterPanel} ${isOpen ? styles.open : styles.collapsed}`}>
        {/* Toggle header */}
        <button
          className={styles.toggleButton}
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-controls="filter-panel-body"
        >
          <span className={styles.toggleIcon}>{isOpen ? '\u25BC' : '\u25B6'}</span>
          <span className={styles.toggleLabel}>
            Filters{activeCount > 0 ? ` (${activeCount} active)` : ''}
          </span>
        </button>

        {/* Panel body */}
        {isOpen && (
          <div id="filter-panel-body" className={styles.body} role="region" aria-label="Report filters">
            {/* Error message */}
            {error && (
              <div className={styles.errorMessage} role="alert">
                {error}
                <button
                  className={styles.dismissError}
                  onClick={() => this.setState({ error: null })}
                  aria-label="Dismiss error"
                >
                  &times;
                </button>
              </div>
            )}

            {/* Filter controls */}
            {filters.map((desc) => {
              switch (desc.controlType) {
                case 'basic':
                  return this.renderBasicFilter(desc);
                case 'advanced':
                  return this.renderAdvancedFilter(desc);
                case 'dateRange':
                  return this.renderDateRangeFilter(desc);
                default:
                  return null;
              }
            })}

            {/* Action buttons */}
            <div className={styles.actions}>
              <button
                className={styles.applyButton}
                onClick={this.handleApply}
                disabled={isApplying}
              >
                {isApplying ? 'Applying...' : 'Apply Filters'}
              </button>
              <button
                className={styles.clearButton}
                onClick={this.handleClear}
                disabled={isApplying}
              >
                Clear All
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }
}

export default FilterPanel;
