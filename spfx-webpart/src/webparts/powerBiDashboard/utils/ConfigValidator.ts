/**
 * ConfigValidator -- Validates web part configuration at startup.
 *
 * Checks that Report ID, Workspace ID, and embed URL are well-formed before
 * the web part attempts token acquisition or embedding.  Returns a typed
 * ValidationResult with specific, actionable error messages.
 */

import {
  type WebPartConfig,
  type ValidationError,
  type ValidationResult,
} from '../models/types';

// ─── Patterns ───────────────────────────────────────────────────────────────

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMBED_URL_PATTERN = /^https:\/\/app\.powerbi\.com\/reportEmbed/i;
const ALTERNATIVE_EMBED_URL_PATTERN =
  /^https:\/\/[a-z0-9-]+\.analysis\.windows\.net\/reportEmbed/i;

// ─── Validator ──────────────────────────────────────────────────────────────

export class ConfigValidator {
  /**
   * Validate the full web part configuration.
   *
   * @param config - The raw property pane values.
   * @returns A ValidationResult indicating whether the config is valid,
   *          with specific error messages for each invalid field.
   */
  public static validate(config: Partial<WebPartConfig>): ValidationResult {
    const errors: ValidationError[] = [];

    errors.push(...ConfigValidator.validateReportId(config.reportId));
    errors.push(...ConfigValidator.validateWorkspaceId(config.workspaceId));
    errors.push(...ConfigValidator.validateEmbedUrl(config.embedUrl));
    errors.push(...ConfigValidator.validateAutoRefreshInterval(config.autoRefreshInterval));

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Quick check: is the minimum required configuration present?
   * Does not validate format -- just checks that required fields are non-empty.
   */
  public static isConfigured(config: Partial<WebPartConfig>): boolean {
    return Boolean(config.reportId && config.workspaceId);
  }

  // ── Individual Field Validators ──

  public static validateReportId(value: string | undefined): ValidationError[] {
    const errors: ValidationError[] = [];
    const field = 'reportId';

    if (!value || value.trim() === '') {
      errors.push({
        field,
        message:
          'Report ID is required. Open the report in Power BI, then copy the GUID from the URL: app.powerbi.com/groups/{workspaceId}/reports/{reportId}',
        value,
      });
      return errors;
    }

    const trimmed = value.trim();

    if (!GUID_PATTERN.test(trimmed)) {
      errors.push({
        field,
        message: `Report ID "${trimmed}" is not a valid GUID. Expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`,
        value: trimmed,
      });
    }

    return errors;
  }

  public static validateWorkspaceId(value: string | undefined): ValidationError[] {
    const errors: ValidationError[] = [];
    const field = 'workspaceId';

    if (!value || value.trim() === '') {
      errors.push({
        field,
        message:
          'Workspace ID is required. Open the workspace in Power BI, then copy the GUID from the URL: app.powerbi.com/groups/{workspaceId}',
        value,
      });
      return errors;
    }

    const trimmed = value.trim();

    if (!GUID_PATTERN.test(trimmed)) {
      // Common mistake: pasting the workspace name instead of the GUID
      if (/\s/.test(trimmed) || /^[a-zA-Z]/.test(trimmed)) {
        errors.push({
          field,
          message: `"${trimmed}" appears to be a workspace name, not a GUID. Open the workspace in Power BI and copy the ID from the URL.`,
          value: trimmed,
        });
      } else {
        errors.push({
          field,
          message: `Workspace ID "${trimmed}" is not a valid GUID. Expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`,
          value: trimmed,
        });
      }
    }

    return errors;
  }

  public static validateEmbedUrl(value: string | undefined): ValidationError[] {
    const errors: ValidationError[] = [];
    const field = 'embedUrl';

    // Embed URL is optional; when present it must be valid
    if (!value || value.trim() === '') {
      return errors;
    }

    const trimmed = value.trim();

    if (!trimmed.startsWith('https://')) {
      errors.push({
        field,
        message: 'Embed URL must use HTTPS.',
        value: trimmed,
      });
      return errors;
    }

    if (
      !EMBED_URL_PATTERN.test(trimmed) &&
      !ALTERNATIVE_EMBED_URL_PATTERN.test(trimmed)
    ) {
      errors.push({
        field,
        message:
          'Embed URL does not match the expected Power BI format. It should start with https://app.powerbi.com/reportEmbed or a regional analysis.windows.net endpoint.',
        value: trimmed,
      });
    }

    return errors;
  }

  public static validateAutoRefreshInterval(
    value: number | undefined,
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const field = 'autoRefreshInterval';

    if (value === undefined || value === 0) {
      return errors; // 0 or undefined means "no auto-refresh"
    }

    if (!Number.isFinite(value) || value < 0) {
      errors.push({
        field,
        message: 'Auto-refresh interval must be a positive number (in seconds) or 0 to disable.',
        value,
      });
      return errors;
    }

    if (value > 0 && value < 30) {
      errors.push({
        field,
        message:
          'Auto-refresh interval must be at least 30 seconds to avoid excessive API calls. Set to 0 to disable.',
        value,
      });
    }

    return errors;
  }

  // ── Formatting ──

  /**
   * Converts a ValidationResult into a human-readable string,
   * suitable for rendering in the web part's property pane description.
   */
  public static formatErrors(result: ValidationResult): string {
    if (result.isValid) {
      return '';
    }

    return result.errors
      .map((e) => `${e.field}: ${e.message}`)
      .join('\n\n');
  }

  /**
   * Returns a mapping of field name to its first error message.
   * Useful for showing inline validation in the property pane.
   */
  public static errorsByField(
    result: ValidationResult,
  ): Record<string, string> {
    const map: Record<string, string> = {};
    for (const error of result.errors) {
      if (!map[error.field]) {
        map[error.field] = error.message;
      }
    }
    return map;
  }
}

export default ConfigValidator;
