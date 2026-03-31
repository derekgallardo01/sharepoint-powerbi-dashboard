# SharePoint Power BI Dashboard

![SPFx 1.22](https://img.shields.io/badge/SPFx-1.22-green?style=flat-square)
![React 18](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=white)
![PowerShell](https://img.shields.io/badge/PowerShell-5.1%2B-5391FE?style=flat-square&logo=powershell&logoColor=white)
![Power Automate](https://img.shields.io/badge/Power%20Automate-Flows-0066FF?style=flat-square)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

A production-ready SharePoint Framework (SPFx) web part that embeds Power BI reports with dynamic filtering, paired with PowerShell health-check scripts and Power Automate alert flows for end-to-end operational monitoring.

---

## Overview

This project solves three common challenges in enterprise Power BI + SharePoint deployments:

1. **Embedding** -- A fully configured SPFx web part that securely embeds Power BI reports in SharePoint Online and Microsoft Teams, with AAD token acquisition, URL-based dynamic filtering, and a responsive layout.
2. **Monitoring** -- PowerShell scripts that audit dataset refreshes, gateway health, workspace permissions, and embed configuration, generating a consolidated HTML report.
3. **Alerting** -- Power Automate flow definitions that poll for refresh failures and data-threshold breaches, then notify stakeholders via email and Teams.

## Architecture

```
+---------------------+       +-----------------------+       +------------------+
|  SharePoint Online  |       |   Power BI Service    |       |  Power Automate  |
|  (SPFx Web Part)    |<----->|   Reports & Datasets  |<----->|  Alert Flows     |
+---------------------+       +-----------------------+       +------------------+
        |                               |
        | AAD Token                     | REST API
        v                               v
+---------------------+       +-----------------------+
|  Azure AD           |       |  PowerShell Health    |
|  App Registration   |       |  Check Scripts        |
+---------------------+       +-----------------------+
```

```mermaid
graph TD
    subgraph SharePoint["SharePoint Online"]
        SP[SharePoint Page]
        WP[SPFx Web Part<br/><i>React 18 Component</i>]
        SP --> WP
    end

    subgraph Authentication["Azure AD Authentication"]
        AAD[AAD Token Provider<br/><i>AadTokenProviderFactory</i>]
        AZURE_AD[Azure Active Directory<br/><i>App Registration</i>]
        AAD -->|"OAuth 2.0<br/>implicit / auth code"| AZURE_AD
    end

    subgraph PowerBI["Power BI Service"]
        API[Power BI REST API<br/><i>api.powerbi.com</i>]
        EMBED[Power BI Embedded Report<br/><i>iframe with powerbi-client</i>]
        API -->|"Embed Token +<br/>Embed URL"| EMBED
    end

    subgraph Monitoring["Operational Monitoring"]
        PA[Power Automate<br/><i>Scheduled Flows</i>]
        PS[PowerShell Health Checks<br/><i>Diagnostic Scripts</i>]
    end

    WP -->|"Request access token<br/>(Power BI scope)"| AAD
    AZURE_AD -->|"JWT Bearer Token"| WP
    WP -->|"GET /reports/{id}<br/>Authorization: Bearer token"| API
    EMBED -->|"Rendered report<br/>with filters"| WP

    PA -->|"Poll refresh status<br/>& threshold alerts"| API
    PS -->|"Audit health &<br/>generate reports"| API

    PA -.->|"Email + Teams<br/>notifications"| STAKEHOLDERS[Stakeholders]
    PS -.->|"HTML health<br/>check report"| ADMIN[IT Administrators]

    style SharePoint fill:#0078d4,stroke:#005a9e,color:#fff
    style Authentication fill:#ff8c00,stroke:#cc7000,color:#fff
    style PowerBI fill:#f2c811,stroke:#c9a60e,color:#333
    style Monitoring fill:#107c10,stroke:#0b5e0b,color:#fff
    style STAKEHOLDERS fill:#e3e3e3,stroke:#999,color:#333
    style ADMIN fill:#e3e3e3,stroke:#999,color:#333
```

## How It Works

When a user navigates to a SharePoint page containing the Power BI Dashboard web part, the following token acquisition and embed flow takes place:

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant SP as SharePoint Page
    participant WP as SPFx Web Part<br/>(React Component)
    participant AAD as AAD Token Provider
    participant Azure as Azure Active Directory
    participant API as Power BI REST API
    participant Report as Embedded Report<br/>(iframe)

    User->>SP: Navigate to SharePoint page
    SP->>WP: Load web part bundle

    Note over WP: Read property pane config<br/>(workspaceId, reportId)

    WP->>AAD: getToken("https://analysis.windows.net/powerbi/api")

    Note over AAD: Check token cache<br/>for existing valid token

    alt Token cached and valid
        AAD-->>WP: Return cached JWT
    else Token expired or missing
        AAD->>Azure: OAuth 2.0 token request<br/>(client_id, scope, user assertion)
        Note over Azure: Validate app registration<br/>& API permissions:<br/>Report.Read.All<br/>Workspace.Read.All
        Azure-->>AAD: Access token (JWT)
        Note over AAD: JWT token with<br/>Power BI scope<br/>exp: ~60 min TTL
        AAD-->>WP: Return fresh JWT
    end

    WP->>API: GET /v1.0/myorg/groups/{workspaceId}/reports/{reportId}
    Note over API: Validate bearer token<br/>& user permissions

    alt Authorized
        API-->>WP: Report metadata<br/>(embedUrl, datasetId)
    else 403 Forbidden
        API-->>WP: Error: insufficient permissions
        WP-->>User: Display error state<br/>with troubleshooting guidance
    end

    WP->>Report: powerbi.embed(embedUrl, accessToken, config)
    Note over Report: Initialize powerbi-client<br/>Apply filters from URL params<br/>Set view mode & layout

    Report-->>User: Rendered interactive report

    Note over WP,Report: Token auto-refresh<br/>triggers before expiry<br/>(tokenExpired event)

    loop Every ~55 minutes
        WP->>AAD: Refresh token
        AAD->>Azure: Token refresh request
        Azure-->>AAD: New access token
        AAD-->>WP: Fresh JWT
        WP->>Report: report.setAccessToken(newToken)
    end
```

---

## Features

### SPFx Web Part
- Secure AAD-based token acquisition (user-owns-data pattern)
- Property pane for workspace ID, report ID, and display options
- Dynamic filtering via URL query parameters (`?pbi_Table_Column=value`)
- Live connection-status indicator with manual refresh
- Responsive layout with loading states and error handling
- Support for SharePoint pages, Teams personal apps, and Teams tabs

### Health Check Scripts
- **Refresh Status** -- audit dataset refresh history with pass/fail summary
- **Gateway Health** -- enumerate gateways and test every data-source connection
- **Permissions Audit** -- workspace access list, dataset permissions, and RLS roles
- **Embed Config Validation** -- GUID checks, token acquisition, API permission tests
- **Dataset Size** -- compare dataset sizes against Pro (1 GB) and Premium (10 GB) limits with configurable warning thresholds
- **Master Runner** -- orchestrates all checks and produces a colour-coded HTML report

### Power Automate Flows
- Hourly polling for dataset refresh failures with email + Teams alerts
- Configurable DAX-based data threshold alerts
- Weekly scheduled report export to PDF with email distribution
- Ready-to-import JSON definitions with documented parameters

---

## Prerequisites

| Requirement | Version / Details |
|---|---|
| Node.js | 18.x (LTS) |
| npm | 9+ |
| Gulp CLI | `npm i -g gulp-cli` |
| SPFx Yeoman Generator | 1.22+ (for scaffolding only) |
| SharePoint Online | Tenant with App Catalog |
| Power BI | Pro or Premium Per User licence |
| Azure AD | App registration with Power BI API permissions |
| PowerShell | 5.1+ or PowerShell 7+ |
| MicrosoftPowerBIMgmt | `Install-Module MicrosoftPowerBIMgmt` |
| Power Automate | Premium licence (for HTTP connector) |

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/your-org/sharepoint-powerbi-dashboard.git
cd sharepoint-powerbi-dashboard/spfx-webpart

# Install dependencies
npm install

# Serve locally (opens the SharePoint Workbench)
gulp serve

# Build and package for production
gulp bundle --ship
gulp package-solution --ship
```

The `.sppkg` package is generated in `spfx-webpart/sharepoint/solution/`. Upload it to your tenant App Catalog and approve the Power BI API permission request in the SharePoint Admin Center.

---

## Web Part Configuration

1. Add the **Power BI Dashboard** web part to a SharePoint page.
2. Open the property pane and enter:
   - **Workspace ID** -- the Power BI workspace GUID (find it in the workspace URL).
   - **Report ID** -- the Power BI report GUID (find it in the report URL).
3. Toggle **Show Filter Pane** and **Show Page Navigation** as needed.
4. Save and publish the page.

### Dynamic Filtering via URL

Append query parameters in the format `pbi_TableName_ColumnName=value` to the page URL to apply filters at load time:

```
https://contoso.sharepoint.com/sites/analytics/SitePages/Sales.aspx?pbi_Sales_Region=West&pbi_Sales_Year=2026
```

Multiple values for the same filter are comma-separated: `pbi_Sales_Region=West,East`.

### Screenshots

Open the following HTML files in your browser to see interactive mockups of the web part:

- **[Dashboard Embedded View](docs/screenshots/dashboard-embedded.html)** -- Power BI report embedded in a SharePoint page with KPI cards, bar chart, donut chart, incident table, and filter pane
- **[Property Pane Configuration](docs/screenshots/property-pane.html)** -- SPFx property pane showing Report ID, Workspace ID, toggle switches, and connection status
- **[Error and Loading States](docs/screenshots/error-state.html)** -- Loading spinner, authentication error, and "no report configured" states side by side

---

## Health Checks

All scripts are in the `health-checks/` directory.

### Run All Checks

```powershell
.\Invoke-PowerBIHealthCheck.ps1 `
    -WorkspaceId "00000000-0000-0000-0000-000000000000" `
    -DatasetId   "11111111-1111-1111-1111-111111111111" `
    -ClientId    "22222222-2222-2222-2222-222222222222" `
    -TenantId    "contoso.onmicrosoft.com" `
    -ReportId    "33333333-3333-3333-3333-333333333333"
```

An HTML report is saved to `health-checks/reports/`. Open **[Health Report Preview](docs/screenshots/health-report.html)** in your browser to see a sample report.

### Individual Scripts

| Script | Purpose |
|---|---|
| `Test-PowerBIRefreshStatus.ps1` | Check dataset refresh history for failures |
| `Test-PowerBIGatewayHealth.ps1` | Verify gateway and data-source connectivity |
| `Test-PowerBIPermissions.ps1` | Audit workspace members, dataset permissions, RLS |
| `Test-PowerBIEmbedConfig.ps1` | Validate embed configuration and token generation |
| `Test-PowerBIDatasetSize.ps1` | Check dataset sizes against Pro and Premium limits |

Each script supports `-Help` via standard PowerShell `Get-Help`.

---

## Power Automate Flows

Pre-built flow definitions are in `power-automate-flows/`. See the [flow README](power-automate-flows/README.md) for import instructions and required connections.

| Flow | Trigger | Action |
|---|---|---|
| `refresh-failure-alert.json` | Every 1 hour | Email + Teams alert on refresh failure |
| `data-threshold-alert.json` | Every 30 minutes | Email + Teams alert when DAX value exceeds threshold |
| `scheduled-report-email.json` | Weekly (Monday 8 AM) | Export report page as PDF and email to distribution list |

---

## Diagrams

Detailed Mermaid diagrams are available in the `docs/diagrams/` directory. These render automatically on GitHub and in any Mermaid-compatible Markdown viewer.

| Diagram | Description |
|---|---|
| [System Architecture](docs/diagrams/architecture.md) | High-level component map showing SharePoint, Azure AD, Power BI, and monitoring layers |
| [Token Acquisition & Embed Flow](docs/diagrams/token-flow.md) | Sequence diagram of the full OAuth token flow from page load to rendered report |
| [Health Check Pipeline](docs/diagrams/health-check-flow.md) | Flowchart of the master health-check runner with parallel script execution |
| [Error Recovery Decision Tree](docs/diagrams/error-recovery.md) | Step-by-step troubleshooting flowchart with concrete actions at every leaf node |
| [Deployment Pipeline](docs/diagrams/deployment-pipeline.md) | End-to-end deployment stages from local dev to production monitoring |

---

## Troubleshooting Playbook

For a comprehensive guide with 13 common issues, step-by-step resolutions, and prevention strategies, see the **[Troubleshooting Playbook](docs/troubleshooting-playbook.md)**. Each issue links to the relevant health check script.

> For an interactive decision tree, see the **[Error Recovery Diagram](docs/diagrams/error-recovery.md)**.

### Quick Reference

| Symptom | Likely Cause | Fix |
|---|---|---|
| Web part shows "Failed to acquire token" | API permission not approved | Approve in SharePoint Admin > API access |
| Report loads but is blank | Wrong report ID or workspace ID | Verify GUIDs in property pane |
| 403 Forbidden on embed | User lacks Power BI Pro licence | Assign Pro or PPU licence |
| Filters not applying | Incorrect URL parameter format | Use `pbi_Table_Column=value` pattern |
| Gateway data source shows FAIL | Credentials expired or server offline | Update credentials in Power BI > Manage gateways |
| Refresh failures overnight | Source system maintenance window | Reschedule refresh or add retry |
| Embed token generation fails | App lacks workspace Member role | Add service principal as Member/Contributor |

---

## Project Structure

```
sharepoint-powerbi-dashboard/
  spfx-webpart/
    config/                        # SPFx build configuration
    src/webparts/powerBiDashboard/
      components/
        IPowerBiDashboardProps.ts  # Props and state interfaces
        PowerBiDashboard.tsx       # Main React component
        PowerBiDashboard.module.scss
      PowerBiDashboardWebPart.ts   # SPFx web part entry point
      PowerBiDashboardWebPart.manifest.json
    package.json
    tsconfig.json
    gulpfile.js
  health-checks/
    Invoke-PowerBIHealthCheck.ps1  # Master runner
    Test-PowerBIRefreshStatus.ps1
    Test-PowerBIGatewayHealth.ps1
    Test-PowerBIPermissions.ps1
    Test-PowerBIEmbedConfig.ps1
    Test-PowerBIDatasetSize.ps1    # Dataset size vs Pro/Premium limits
    reports/                       # Generated HTML reports (git-ignored)
  power-automate-flows/
    refresh-failure-alert.json
    data-threshold-alert.json
    scheduled-report-email.json    # Weekly PDF report export + email
    README.md
  docs/
    troubleshooting-playbook.md    # 13-issue troubleshooting guide
    diagrams/
      architecture.md              # System architecture (Mermaid)
      token-flow.md                # Token acquisition sequence diagram
      health-check-flow.md         # Health check pipeline flowchart
      error-recovery.md            # Error recovery decision tree
      deployment-pipeline.md       # Deployment stages flowchart
    screenshots/
      dashboard-embedded.html      # Embedded report mockup
      health-report.html           # Health check report mockup
      property-pane.html           # Property pane configuration mockup
      error-state.html             # Loading, error, and no-data states
  .gitignore
  README.md
```

---

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for prerequisites, setup instructions, development workflow, and code style guidelines.

---

## Changelog

### v1.1.0

- Added `Test-PowerBIDatasetSize.ps1` health check for monitoring dataset sizes against Pro and Premium limits
- Added `scheduled-report-email.json` Power Automate flow for weekly PDF report distribution
- Added comprehensive [Troubleshooting Playbook](docs/troubleshooting-playbook.md) with 13 documented issues
- Updated health check script table and flow reference

### v1.0.0

- SPFx web part with AAD token acquisition, dynamic URL filtering, and responsive layout
- Health check scripts: refresh status, gateway health, permissions audit, embed config validation
- Power Automate flows: refresh failure alert, data threshold alert
- Architecture diagrams and HTML screenshot mockups
- Deployment documentation and project scaffolding

---

## Roadmap

Planned features for future releases:

- **Workspace dashboard web part** -- embed multiple reports in a tabbed layout with workspace-level navigation
- **Automated report snapshots** -- scheduled capture of report visuals to a SharePoint image library for historical comparison
- **Power BI REST API proxy** -- Azure Function middleware for server-side token management (app-owns-data pattern)
- **Multi-language support** -- localized property pane labels and error messages for global deployments
- **Capacity monitoring** -- health check scripts for Premium capacity metrics (CPU, memory, query duration)

---

## License

This project is licensed under the [MIT License](LICENSE).
