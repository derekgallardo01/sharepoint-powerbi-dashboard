# Error Recovery Decision Tree

```mermaid
flowchart TD
    START([User reports<br/>Power BI issue]) --> LOADING{Is the report<br/>loading at all?}

    LOADING -->|"No -- blank or error"| TOKEN{Check embed token.<br/>Is there a token error<br/>in browser console?}
    LOADING -->|"Yes -- but with issues"| VISUAL{What is the<br/>visual symptom?}

    %% Token branch
    TOKEN -->|"Token error present"| EXPIRED{Is the token<br/>expired?}
    TOKEN -->|"No token error"| PERMS{Check HTTP status.<br/>Is it a 403<br/>Forbidden?}

    EXPIRED -->|Yes| FIX_REFRESH["<b>Action:</b> Token auto-refresh<br/>may have failed.<br/>1. Hard-refresh the page<br/>2. Clear browser cache<br/>3. Re-consent the app in<br/>SharePoint Admin > API access"]
    EXPIRED -->|No| FIX_TOKEN["<b>Action:</b> Token acquisition failed.<br/>1. Verify App Registration client ID<br/>2. Check API permissions include<br/>Report.Read.All<br/>3. Ensure admin consent is granted"]

    PERMS -->|"Yes -- 403"| FIX_PERMS["<b>Action:</b> Verify API permissions.<br/>1. User needs Power BI Pro license<br/>2. App needs workspace Member role<br/>3. Check AAD app has<br/>Power BI Service permissions<br/>4. Re-approve in SharePoint Admin"]
    PERMS -->|"No -- other error"| FIX_CONFIG["<b>Action:</b> Validate embed config.<br/>1. Verify Report ID GUID is correct<br/>2. Verify Workspace ID GUID is correct<br/>3. Run Test-PowerBIEmbedConfig.ps1<br/>to diagnose"]

    %% Visual issues branch
    VISUAL -->|"Tiles are blank<br/>or show errors"| DATAREFRESH{Check dataset<br/>refresh status.<br/>Did the last<br/>refresh fail?}
    VISUAL -->|"Report loads<br/>but is slow"| PERFORMANCE{Is Row-Level<br/>Security (RLS)<br/>configured?}
    VISUAL -->|"Filters not<br/>applying"| FIX_FILTERS["<b>Action:</b> Fix URL filter format.<br/>1. Use pattern: pbi_Table_Column=value<br/>2. Check table/column names match<br/>exactly (case-sensitive)<br/>3. Comma-separate multiple values<br/>4. Verify filter pane is enabled"]

    %% Data refresh branch
    DATAREFRESH -->|"Yes -- refresh failed"| GATEWAY{Is the gateway<br/>online?}
    DATAREFRESH -->|"No -- refresh succeeded"| FIX_DATASET["<b>Action:</b> Dataset is stale or empty.<br/>1. Check source data availability<br/>2. Verify DAX measures return data<br/>3. Test the report in Power BI Service<br/>directly (not embedded)"]

    GATEWAY -->|"Gateway offline"| FIX_GW_OFFLINE["<b>Action:</b> Restore gateway.<br/>1. Check gateway server is running<br/>2. Restart the On-premises data<br/>gateway service<br/>3. Verify network connectivity<br/>4. Run Test-PowerBIGatewayHealth.ps1"]
    GATEWAY -->|"Gateway online"| FIX_GW_CREDS["<b>Action:</b> Fix data source credentials.<br/>1. Go to Power BI > Settings > Gateways<br/>2. Update expired credentials<br/>3. Test each data source connection<br/>4. Re-trigger manual refresh"]

    %% Performance branch
    PERFORMANCE -->|"Yes -- many RLS roles"| FIX_RLS["<b>Action:</b> Optimize RLS.<br/>1. Reduce number of RLS roles<br/>2. Simplify DAX filter expressions<br/>3. Use USERELATIONSHIP instead<br/>of complex CALCULATE filters<br/>4. Consider pre-aggregating data"]
    PERFORMANCE -->|"No RLS or few roles"| FIX_PERF["<b>Action:</b> Optimize report performance.<br/>1. Reduce visuals per page (< 8)<br/>2. Avoid high-cardinality slicers<br/>3. Enable query caching in dataset<br/>4. Use aggregations / composite model<br/>5. Check Power BI Performance Analyzer"]

    %% Styling
    style START fill:#5c2d91,stroke:#3b1d61,color:#fff
    style LOADING fill:#0078d4,stroke:#005a9e,color:#fff
    style TOKEN fill:#0078d4,stroke:#005a9e,color:#fff
    style VISUAL fill:#0078d4,stroke:#005a9e,color:#fff
    style EXPIRED fill:#ff8c00,stroke:#cc7000,color:#fff
    style PERMS fill:#ff8c00,stroke:#cc7000,color:#fff
    style DATAREFRESH fill:#ff8c00,stroke:#cc7000,color:#fff
    style GATEWAY fill:#ff8c00,stroke:#cc7000,color:#fff
    style PERFORMANCE fill:#ff8c00,stroke:#cc7000,color:#fff

    style FIX_REFRESH fill:#107c10,stroke:#0b5e0b,color:#fff
    style FIX_TOKEN fill:#107c10,stroke:#0b5e0b,color:#fff
    style FIX_PERMS fill:#107c10,stroke:#0b5e0b,color:#fff
    style FIX_CONFIG fill:#107c10,stroke:#0b5e0b,color:#fff
    style FIX_FILTERS fill:#107c10,stroke:#0b5e0b,color:#fff
    style FIX_DATASET fill:#107c10,stroke:#0b5e0b,color:#fff
    style FIX_GW_OFFLINE fill:#107c10,stroke:#0b5e0b,color:#fff
    style FIX_GW_CREDS fill:#107c10,stroke:#0b5e0b,color:#fff
    style FIX_RLS fill:#107c10,stroke:#0b5e0b,color:#fff
    style FIX_PERF fill:#107c10,stroke:#0b5e0b,color:#fff
```
