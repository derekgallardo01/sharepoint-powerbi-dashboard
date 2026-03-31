# ADR 002: PowerShell-Based Health Check Pipeline

## Status

Accepted

## Date

2026-02-18

## Context

The Power BI + SharePoint deployment has multiple failure modes that are invisible to end users until a report fails to load:

- Dataset refresh failures (stale data)
- Gateway connectivity issues (data source unreachable)
- Permission drift (users added/removed from workspaces)
- Embed configuration errors (expired app registration, revoked API permissions)
- Dataset size growth exceeding Pro/Premium limits

We need an automated monitoring solution that IT administrators can run on-demand or on a schedule to detect these issues before users encounter them.

### Options Evaluated

1. **Azure Monitor + Log Analytics**: Full-featured, but requires Premium capacity and Azure infrastructure. Overkill for organisations on Pro licensing.
2. **Power Automate-only monitoring**: Can poll the Power BI REST API, but limited scripting capability, no local report generation, and premium connector licensing for HTTP requests.
3. **PowerShell scripts with REST API**: Lightweight, runs anywhere (local, Azure Automation, GitHub Actions), full scripting flexibility, and the `MicrosoftPowerBIMgmt` module handles authentication.
4. **Custom .NET console app**: More structured, but higher barrier to contribution, requires compilation, and adds toolchain dependencies.

### Constraints

- Must work with Power BI Pro licensing (no Premium-only APIs).
- Must run on Windows PowerShell 5.1 (enterprise standard) and PowerShell 7+.
- Must produce output that non-technical stakeholders can understand.
- Must be modular enough that teams can run individual checks without executing the full suite.

## Decision

We will use a **modular PowerShell pipeline** with individual diagnostic scripts and a master aggregator:

```
Invoke-PowerBIHealthCheck.ps1  (master runner)
  |-- Test-PowerBIRefreshStatus.ps1
  |-- Test-PowerBIGatewayHealth.ps1
  |-- Test-PowerBIPermissions.ps1
  |-- Test-PowerBIEmbedConfig.ps1
  |-- Test-PowerBIDatasetSize.ps1
  |-- Get-PowerBIUsageMetrics.ps1
```

### Architecture Principles

1. **Single Responsibility**: Each script tests one concern and returns a structured PSCustomObject with `Status` (Pass/Warn/Fail), `Details`, and `Recommendations`.
2. **Master Aggregator**: `Invoke-PowerBIHealthCheck.ps1` calls each script, collects results, and renders a colour-coded HTML report.
3. **Fail-Safe Execution**: If one script throws, the master runner catches the exception, logs it as a Fail result, and continues executing remaining scripts.
4. **Idempotent**: Scripts only read data. No writes, no side effects, safe to run at any time.
5. **Configurable Thresholds**: Warning and failure thresholds (e.g., dataset size percentage, refresh failure count) are exposed as parameters with sensible defaults.

### Output Format

The master runner generates a self-contained HTML report with:
- Summary scorecard (Pass/Warn/Fail counts)
- Expandable detail sections per check
- Colour coding (green/amber/red)
- Timestamp and environment metadata
- Actionable recommendations for every non-Pass result

## Consequences

### Benefits

- **Zero infrastructure**: Runs on any machine with PowerShell and the `MicrosoftPowerBIMgmt` module. No Azure subscription required.
- **Modular**: Teams can run `Test-PowerBIRefreshStatus.ps1` alone without pulling in gateway or permission checks.
- **CI/CD friendly**: Scripts exit with appropriate exit codes, making them suitable for Azure Pipelines, GitHub Actions, or scheduled tasks.
- **Stakeholder-friendly output**: The HTML report is self-contained and can be emailed, uploaded to SharePoint, or viewed in any browser.
- **Extensible**: Adding a new check requires creating a single script that returns the standard result object. The master runner picks it up automatically.

### Trade-offs

- **No real-time monitoring**: Scripts run on-demand or on a schedule; they do not provide continuous observability. For real-time alerting, the Power Automate flows fill this gap.
- **Authentication scope**: Scripts authenticate as a user (interactive or service principal), which means the health check results are scoped to that identity's permissions. A service principal with workspace Member access is recommended.
- **PowerShell dependency**: Teams using macOS or Linux must use PowerShell 7+. The `MicrosoftPowerBIMgmt` module has full cross-platform support, but this is an additional requirement.

### Mitigations

- Power Automate flows (`refresh-failure-alert.json`, `data-threshold-alert.json`) provide real-time alerting for the most critical failure modes.
- Documentation includes service principal setup instructions with minimal required permissions.
- CI/CD examples in the deployment pipeline diagram show how to run health checks as a post-deployment gate.
