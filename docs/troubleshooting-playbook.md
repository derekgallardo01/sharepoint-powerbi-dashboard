# Troubleshooting Playbook

A comprehensive guide covering the most common issues in SharePoint + Power BI deployments. Each entry includes symptoms, root cause, step-by-step resolution, and preventive measures.

---

## Table of Contents

1. [Authentication: Failed to Acquire Token](#1-authentication-failed-to-acquire-token)
2. [Authentication: Consent Prompt Loop](#2-authentication-consent-prompt-loop)
3. [Embedding: Report Loads but is Blank](#3-embedding-report-loads-but-is-blank)
4. [Embedding: 403 Forbidden on Embed](#4-embedding-403-forbidden-on-embed)
5. [Embedding: "Report Not Found" Error](#5-embedding-report-not-found-error)
6. [Data Refresh: Scheduled Refresh Fails Overnight](#6-data-refresh-scheduled-refresh-fails-overnight)
7. [Data Refresh: Gateway Data Source Connection Error](#7-data-refresh-gateway-data-source-connection-error)
8. [Data Refresh: Dataset Exceeds Size Limit](#8-data-refresh-dataset-exceeds-size-limit)
9. [Performance: Report Takes Too Long to Load](#9-performance-report-takes-too-long-to-load)
10. [Performance: Token Refresh Causes Flicker](#10-performance-token-refresh-causes-flicker)
11. [Configuration: Filters Not Applying from URL](#11-configuration-filters-not-applying-from-url)
12. [Configuration: Web Part Not Appearing in Toolbox](#12-configuration-web-part-not-appearing-in-toolbox)
13. [Configuration: Health Check Scripts Return Empty Results](#13-configuration-health-check-scripts-return-empty-results)

---

## Authentication

### 1. Authentication: Failed to Acquire Token

**Symptom:** The web part displays "Failed to acquire token" or "Token acquisition error" immediately after the page loads.

**Root Cause:** The Azure AD app registration's API permissions for Power BI have not been approved by a tenant administrator, or the API permission request from the SPFx package was not granted in the SharePoint Admin Center.

**Resolution Steps:**

1. Open the **SharePoint Admin Center** > **Advanced** > **API access**.
2. Look for a pending request for `https://analysis.windows.net/powerbi/api`.
3. Select the request and click **Approve**.
4. If no pending request exists, verify the app registration in Azure AD:
   - Navigate to **Azure Portal** > **Azure Active Directory** > **App registrations**.
   - Locate the app used by the SPFx solution (check the `webApiPermissionRequests` in the manifest).
   - Under **API permissions**, confirm that `Power BI Service > Report.Read.All` and `Workspace.Read.All` are listed.
   - Click **Grant admin consent**.
5. Wait 5-10 minutes for propagation, then reload the SharePoint page.

**Prevention:**

- Include API approval as a deployment checklist step.
- Run `Test-PowerBIEmbedConfig.ps1` after deployment to verify token acquisition.

**Related Health Check:** `Test-PowerBIEmbedConfig.ps1`

---

### 2. Authentication: Consent Prompt Loop

**Symptom:** Users are repeatedly prompted to consent when opening the page. After consenting, the page reloads and asks again.

**Root Cause:** The Azure AD app has user-level consent required but the redirect URI is misconfigured, causing the consent response to be lost.

**Resolution Steps:**

1. In **Azure Portal** > **App registrations** > your app > **Authentication**:
   - Verify the **Redirect URIs** include `https://*.sharepoint.com/_forms/spfxsinglesignon.aspx`.
   - Ensure **ID tokens** is checked under Implicit grant.
2. If using multi-tenant, confirm "Accounts in any organizational directory" is selected.
3. In the app's **API permissions**, click **Grant admin consent for [tenant]** to eliminate individual user consent.
4. Clear browser cookies for `login.microsoftonline.com` and retry.

**Prevention:**

- Always grant admin consent during deployment so individual users are never prompted.
- Validate redirect URIs with `Test-PowerBIEmbedConfig.ps1`.

**Related Health Check:** `Test-PowerBIEmbedConfig.ps1`

---

## Embedding

### 3. Embedding: Report Loads but is Blank

**Symptom:** The web part iframe loads (no error message), but the report area is completely white with no visuals.

**Root Cause:** The Report ID or Workspace ID in the property pane is incorrect, or the report has no data due to Row-Level Security (RLS) filtering the current user out.

**Resolution Steps:**

1. Open the report directly in `app.powerbi.com` -- does it render?
2. Verify the **Workspace ID** and **Report ID** in the web part property pane:
   - Open the report in Power BI Service.
   - The URL format is `app.powerbi.com/groups/{workspaceId}/reports/{reportId}`.
   - Copy the GUIDs and paste them into the property pane.
3. If the report works in Power BI but is blank in SharePoint, check RLS:
   - In Power BI Desktop, go to **Modeling** > **View as Roles** and test with the user's identity.
   - In Power BI Service, go to **Dataset settings** > **Row-level security** and verify role membership.
4. Check browser console (F12) for JavaScript errors from `powerbi-client`.

**Prevention:**

- Test with a non-admin user account after deployment.
- Run `Test-PowerBIPermissions.ps1` to audit RLS role assignments.

**Related Health Check:** `Test-PowerBIPermissions.ps1`, `Test-PowerBIEmbedConfig.ps1`

---

### 4. Embedding: 403 Forbidden on Embed

**Symptom:** The web part shows "You don't have permission to view this report" or a 403 error.

**Root Cause:** The viewing user does not have a Power BI Pro or Premium Per User (PPU) licence, or they lack workspace access.

**Resolution Steps:**

1. Confirm the user has a **Power BI Pro** or **PPU** licence in Microsoft 365 Admin Center > **Users** > **Active users** > select user > **Licenses and apps**.
2. If the workspace is on Premium capacity, a Pro licence is not required for viewers. Verify the workspace is assigned to a Premium capacity:
   - In Power BI Service, open **Workspace settings** > **Premium** tab.
3. Check workspace access:
   - Open the workspace > **Access** panel.
   - Ensure the user (or a group they belong to) has at least **Viewer** role.
4. If using a service principal for embedding, confirm it has **Member** or **Contributor** role on the workspace.

**Prevention:**

- Use security groups for workspace access management.
- Run `Test-PowerBIPermissions.ps1` periodically to audit access.

**Related Health Check:** `Test-PowerBIPermissions.ps1`

---

### 5. Embedding: "Report Not Found" Error

**Symptom:** Error message "The report could not be found" or HTTP 404 from the Power BI API.

**Root Cause:** The report was deleted, moved to another workspace, or the Report ID GUID is a typo.

**Resolution Steps:**

1. Open `https://app.powerbi.com/groups/{workspaceId}/reports/{reportId}` directly. If it returns 404, the report does not exist at that location.
2. Search for the report in Power BI Service using the search bar.
3. If the report was moved, update the **Workspace ID** and **Report ID** in the web part property pane.
4. If the report was deleted, restore it from the workspace trash (available for 7 days) or republish from Power BI Desktop.

**Prevention:**

- Avoid moving reports between workspaces without updating embed configurations.
- Run `Test-PowerBIEmbedConfig.ps1` after any workspace reorganization.

**Related Health Check:** `Test-PowerBIEmbedConfig.ps1`

---

## Data Refresh

### 6. Data Refresh: Scheduled Refresh Fails Overnight

**Symptom:** The Power Automate refresh-failure-alert flow fires, or the health check shows refresh status as "Failed" for overnight schedules.

**Root Cause:** The data source system has a maintenance window that overlaps with the refresh schedule, or gateway credentials have expired.

**Resolution Steps:**

1. Check the refresh history in Power BI Service:
   - Open the dataset > **Settings** > **Scheduled refresh** > **Refresh history**.
   - Note the error message (e.g., "Unable to connect", "Timeout", "Credentials expired").
2. For connection errors:
   - Verify the source system is online during the scheduled refresh time.
   - Adjust the refresh schedule to avoid maintenance windows.
3. For credential errors:
   - Go to **Settings** > **Data source credentials** > **Edit credentials** and re-enter.
4. For timeout errors:
   - Reduce the dataset scope (incremental refresh, fewer tables).
   - Increase the timeout in gateway configuration if using an on-premises gateway.
5. Enable **Send refresh failure notification emails** in dataset settings.

**Prevention:**

- Schedule refreshes outside known maintenance windows.
- Set up the `refresh-failure-alert.json` Power Automate flow for immediate notification.
- Run `Test-PowerBIRefreshStatus.ps1` daily via a scheduled task.

**Related Health Check:** `Test-PowerBIRefreshStatus.ps1`

---

### 7. Data Refresh: Gateway Data Source Connection Error

**Symptom:** Health check reports "FAIL" for one or more gateway data sources. The error is "Unable to connect" or "DM_GWPipeline_Gateway_DataSourceAccessError".

**Root Cause:** Gateway credentials have expired, the gateway machine is offline, or the data source server is unreachable from the gateway network.

**Resolution Steps:**

1. In Power BI Service, go to **Settings** (gear icon) > **Manage connections and gateways**.
2. Locate the gateway cluster:
   - If the gateway status is **Offline**, RDP into the gateway machine and start the "On-premises data gateway" Windows service.
   - If the gateway is **Online** but a data source shows an error, select the data source and click **Test connection**.
3. If test connection fails:
   - Click **Edit credentials** and re-enter the username/password or OAuth token.
   - Verify network connectivity from the gateway machine to the data source (ping, telnet to port).
   - Check firewall rules on the data source server.
4. For OAuth data sources, the token may have expired -- re-authenticate through the credential editor.

**Prevention:**

- Use service accounts with non-expiring passwords for data source connections.
- Run `Test-PowerBIGatewayHealth.ps1` weekly.
- Set up monitoring on the gateway machine (CPU, memory, disk, service status).

**Related Health Check:** `Test-PowerBIGatewayHealth.ps1`

---

### 8. Data Refresh: Dataset Exceeds Size Limit

**Symptom:** Refresh fails with "The dataset size limit has been reached" or the health check flags a dataset as exceeding Pro or Premium limits.

**Root Cause:** Import-mode dataset has grown beyond the 1 GB Pro limit or 10 GB Premium limit due to data growth.

**Resolution Steps:**

1. Run `Test-PowerBIDatasetSize.ps1` to get the current size of all datasets:
   ```powershell
   .\Test-PowerBIDatasetSize.ps1 -WorkspaceId "your-workspace-guid"
   ```
2. Reduce dataset size:
   - Remove unused tables and columns in Power BI Desktop.
   - Apply query-level filters to limit imported rows.
   - Convert large tables to **DirectQuery** mode while keeping small dimension tables in import mode (composite model).
   - Enable **incremental refresh** to keep only recent partitions in the dataset.
3. If on Pro, consider upgrading to Premium Per User (10 GB limit) or Premium capacity (up to 400 GB with large dataset format).
4. Republish the reduced dataset and verify the refresh succeeds.

**Prevention:**

- Monitor dataset size trends with `Test-PowerBIDatasetSize.ps1` on a schedule.
- Set the `WarningThresholdPercent` to 80 to catch growth before it hits the limit.
- Design data models with size in mind from the start.

**Related Health Check:** `Test-PowerBIDatasetSize.ps1`

---

## Performance

### 9. Performance: Report Takes Too Long to Load

**Symptom:** The web part shows a loading spinner for 10+ seconds before the report appears, or individual visuals load slowly.

**Root Cause:** The report has too many visuals per page, uses complex DAX measures, or the dataset is in DirectQuery mode with a slow source.

**Resolution Steps:**

1. Open the report in Power BI Desktop and check performance:
   - **View** > **Performance analyzer** > **Start recording** > refresh visuals.
   - Identify slow visuals (> 2 seconds) and check their DAX queries.
2. Reduce page complexity:
   - Limit each page to 8-10 visuals.
   - Use bookmarks and drill-through instead of cramming everything onto one page.
3. Optimize DAX:
   - Replace `CALCULATE(SUM(...), FILTER(ALL(...)))` patterns with `SUMX` or context-appropriate alternatives.
   - Avoid iterators over large tables.
4. For DirectQuery:
   - Add aggregations in Power BI Desktop (composite model).
   - Optimize the source database with indexes and materialized views.
5. Enable **query caching** in dataset settings (Premium only).

**Prevention:**

- Establish report page visual count limits in your organization's standards.
- Test load times as part of the report publishing process.
- Use Performance analyzer reports during development.

**Related Health Check:** `Invoke-PowerBIHealthCheck.ps1` (overall report)

---

### 10. Performance: Token Refresh Causes Flicker

**Symptom:** Every ~55 minutes the embedded report briefly flickers or shows a loading state as the token refreshes.

**Root Cause:** The token expiration handler is re-embedding the report instead of calling `report.setAccessToken()`.

**Resolution Steps:**

1. Open `PowerBiDashboard.tsx` and locate the token refresh logic.
2. Ensure the `tokenExpired` event handler calls `setAccessToken()`:
   ```typescript
   report.on('tokenExpired', async () => {
     const newToken = await this.getAccessToken();
     await report.setAccessToken(newToken);
   });
   ```
3. Do NOT call `powerbi.embed()` again -- that causes a full re-render.
4. Set the token refresh interval to ~5 minutes before expiry (typically 55 minutes for a 60-minute token).

**Prevention:**

- Follow the token refresh pattern in the project's `PowerBiDashboard.tsx` reference implementation.
- Test token refresh in a long-running browser session.

**Related Health Check:** `Test-PowerBIEmbedConfig.ps1`

---

## Configuration

### 11. Configuration: Filters Not Applying from URL

**Symptom:** URL query parameters like `?pbi_Sales_Region=West` are ignored and the report loads without filters.

**Root Cause:** The URL parameter format does not match the expected pattern, or the table/column name contains spaces that are not encoded correctly.

**Resolution Steps:**

1. Verify the URL parameter format: `pbi_TableName_ColumnName=value`.
2. For table or column names with spaces, replace spaces with underscores in the URL:
   - Table "Sales Data", Column "Region Name" becomes `pbi_Sales_Data_Region_Name=West`.
3. For multiple values, use comma separation: `pbi_Sales_Region=West,East`.
4. Check that the table and column names match the data model exactly (case-sensitive).
5. Open the browser console (F12) and look for filter parsing logs from the web part.

**Prevention:**

- Use simple table and column names without spaces in the Power BI data model.
- Document the available filter parameters for each report.
- Include URL filter examples in the web part property pane description.

**Related Health Check:** `Test-PowerBIEmbedConfig.ps1`

---

### 12. Configuration: Web Part Not Appearing in Toolbox

**Symptom:** After deploying the `.sppkg` file to the App Catalog, the Power BI Dashboard web part does not appear in the page toolbox.

**Root Cause:** The app was not approved in the App Catalog, or the solution was not deployed to the specific site collection.

**Resolution Steps:**

1. Open the **App Catalog** site (`/sites/appcatalog`).
2. In the **Apps for SharePoint** library, find the `.sppkg` file.
3. Ensure the **Deployed** column shows **Yes**. If not, select the file and click **Deploy**.
4. Check if the package requires tenant-wide deployment:
   - If the manifest has `"skipFeatureDeployment": true`, it should be available on all sites after catalog deployment.
   - If `false`, go to the target site > **Site Contents** > **New** > **App** and add it.
5. Wait 5-10 minutes for the CDN to propagate, then refresh the page and check the toolbox.

**Prevention:**

- Set `"skipFeatureDeployment": true` in the solution manifest for organization-wide web parts.
- Include App Catalog deployment verification in your CI/CD pipeline.

**Related Health Check:** `Test-PowerBIEmbedConfig.ps1`

---

### 13. Configuration: Health Check Scripts Return Empty Results

**Symptom:** Running a health check script (e.g., `Test-PowerBIRefreshStatus.ps1`) completes without errors but returns zero results.

**Root Cause:** The authenticated account does not have workspace access, or the Workspace/Dataset GUIDs are incorrect.

**Resolution Steps:**

1. Verify the GUIDs:
   - Open the workspace in Power BI Service and copy the Workspace ID from the URL.
   - Open the dataset settings and copy the Dataset ID.
2. Verify account permissions:
   - The account running the script must have at least **Viewer** access to the workspace.
   - For admin-level scripts (e.g., gateway health), the account needs **Power BI Service Administrator** role.
3. Test connectivity manually:
   ```powershell
   Connect-PowerBIServiceAccount
   Get-PowerBIWorkspace -Id "your-workspace-guid"
   Get-PowerBIDataset -WorkspaceId "your-workspace-guid"
   ```
4. If using a service principal, ensure it is enabled in Power BI Admin Portal:
   - **Admin Portal** > **Tenant settings** > **Developer settings** > **Allow service principals to use Power BI APIs**.

**Prevention:**

- Run `Invoke-PowerBIHealthCheck.ps1` with `-WhatIf` first to validate parameters.
- Use a dedicated service account with documented permissions.

**Related Health Check:** `Invoke-PowerBIHealthCheck.ps1`

---

## Quick Reference Matrix

| # | Issue | Category | Primary Health Check | Severity |
|---|-------|----------|---------------------|----------|
| 1 | Failed to acquire token | Authentication | `Test-PowerBIEmbedConfig.ps1` | Critical |
| 2 | Consent prompt loop | Authentication | `Test-PowerBIEmbedConfig.ps1` | High |
| 3 | Report loads but is blank | Embedding | `Test-PowerBIPermissions.ps1` | High |
| 4 | 403 Forbidden on embed | Embedding | `Test-PowerBIPermissions.ps1` | Critical |
| 5 | Report not found | Embedding | `Test-PowerBIEmbedConfig.ps1` | High |
| 6 | Scheduled refresh fails | Data Refresh | `Test-PowerBIRefreshStatus.ps1` | High |
| 7 | Gateway connection error | Data Refresh | `Test-PowerBIGatewayHealth.ps1` | Critical |
| 8 | Dataset exceeds size limit | Data Refresh | `Test-PowerBIDatasetSize.ps1` | High |
| 9 | Slow report loading | Performance | `Invoke-PowerBIHealthCheck.ps1` | Medium |
| 10 | Token refresh flicker | Performance | `Test-PowerBIEmbedConfig.ps1` | Low |
| 11 | URL filters not applying | Configuration | `Test-PowerBIEmbedConfig.ps1` | Medium |
| 12 | Web part not in toolbox | Configuration | `Test-PowerBIEmbedConfig.ps1` | High |
| 13 | Health check empty results | Configuration | `Invoke-PowerBIHealthCheck.ps1` | Medium |
