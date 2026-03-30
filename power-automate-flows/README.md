# Power Automate Flows

This directory contains exportable Power Automate flow definitions for monitoring Power BI datasets and alerting on issues.

## Flows

### 1. Refresh Failure Alert (`refresh-failure-alert.json`)

Monitors Power BI dataset refresh history on an hourly schedule. When a failed refresh is detected, the flow sends:

- **Email notification** via Office 365 Outlook with failure details and a direct link to the dataset.
- **Teams channel message** in the configured channel with a summary of the failure.

**Parameters to configure:**

| Parameter           | Description                                      |
|---------------------|--------------------------------------------------|
| `WorkspaceId`       | Power BI workspace GUID                          |
| `DatasetId`         | Power BI dataset GUID to monitor                 |
| `NotificationEmail` | Email address for failure alerts                 |
| `TeamsTeamId`       | Microsoft Teams team ID                          |
| `TeamsChannelId`    | Microsoft Teams channel ID                       |

### 2. Data Threshold Alert (`data-threshold-alert.json`)

Executes a DAX query against a Power BI dataset every 30 minutes and compares the result to a numeric threshold. When the value exceeds the threshold, the flow sends:

- **Email notification** with the current value, threshold, and the DAX query used.
- **Teams channel message** summarising the breach.

**Parameters to configure:**

| Parameter           | Description                                                        |
|---------------------|--------------------------------------------------------------------|
| `WorkspaceId`       | Power BI workspace GUID                                            |
| `DatasetId`         | Power BI dataset GUID to query                                     |
| `DaxQuery`          | DAX expression returning a single row/column (the value to check)  |
| `ThresholdValue`    | Numeric threshold; alert fires when the value exceeds this         |
| `MetricName`        | Friendly name shown in notifications (e.g., "Daily Sales Amount")  |
| `NotificationEmail` | Email address for threshold breach alerts                          |
| `TeamsTeamId`       | Microsoft Teams team ID                                            |
| `TeamsChannelId`    | Microsoft Teams channel ID                                         |

## Import Instructions

1. Open [Power Automate](https://make.powerautomate.com/).
2. Navigate to **My flows** > **Import** > **Import Package (Legacy)** or use the **Import from file** option depending on your environment.
3. Upload the `.json` file for the flow you want to install.
4. During import, configure the **connection references**:
   - **Office 365 Outlook** -- used for sending email notifications.
   - **Microsoft Teams** -- used for posting channel messages.
5. After import, open the flow and update the **parameter values** listed above with your environment-specific GUIDs and addresses.
6. If using service-principal authentication for the HTTP actions, register an Azure AD app with the `Dataset.Read.All` permission on the Power BI API and provide the client ID, secret, and tenant ID as flow variables.
7. **Turn the flow on** and perform a test run to verify connectivity.

## Required Connections

| Connector           | Purpose                          | License requirement       |
|---------------------|----------------------------------|---------------------------|
| Office 365 Outlook  | Send email alerts                | Included with Microsoft 365 |
| Microsoft Teams     | Post channel messages            | Included with Microsoft 365 |
| HTTP (Premium)      | Call Power BI REST API           | Power Automate Premium or per-flow plan |

> **Note:** The HTTP action with Azure AD authentication is a premium connector. A Power Automate Premium licence (or per-flow plan) is required to run these flows in production.

## Customisation Tips

- **Change the schedule**: Edit the `Recurrence` trigger to adjust the polling interval.
- **Add Adaptive Cards**: Replace the Teams HTML message with an Adaptive Card for richer formatting and action buttons.
- **Multiple datasets**: Duplicate the flow or add an `Apply to each` loop over an array of dataset IDs stored in a SharePoint list.
- **Escalation**: Chain a second condition to send a high-priority alert or call a webhook if the failure count exceeds a threshold (e.g., 3 consecutive failures).
