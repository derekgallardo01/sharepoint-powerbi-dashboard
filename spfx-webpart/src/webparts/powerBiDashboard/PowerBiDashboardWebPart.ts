import * as React from 'react';
import * as ReactDom from 'react-dom';
import { Version } from '@microsoft/sp-core-library';
import {
  type IPropertyPaneConfiguration,
  PropertyPaneTextField,
  PropertyPaneToggle
} from '@microsoft/sp-property-pane';
import { BaseClientSideWebPart } from '@microsoft/sp-webpart-base';

import PowerBiDashboard from './components/PowerBiDashboard';
import { IPowerBiDashboardProps } from './components/IPowerBiDashboardProps';

export interface IPowerBiDashboardWebPartProps {
  reportId: string;
  workspaceId: string;
  embedUrl: string;
  filterPaneEnabled: boolean;
  navContentPaneEnabled: boolean;
}

export default class PowerBiDashboardWebPart extends BaseClientSideWebPart<IPowerBiDashboardWebPartProps> {

  public render(): void {
    const element: React.ReactElement<IPowerBiDashboardProps> = React.createElement(
      PowerBiDashboard,
      {
        reportId: this.properties.reportId,
        workspaceId: this.properties.workspaceId,
        embedUrl: this.properties.embedUrl,
        filterPaneEnabled: this.properties.filterPaneEnabled,
        navContentPaneEnabled: this.properties.navContentPaneEnabled,
        context: this.context,
        domElement: this.domElement,
        onConfigure: (): void => {
          this.context.propertyPane.open();
        }
      }
    );

    ReactDom.render(element, this.domElement);
  }

  protected onDispose(): void {
    ReactDom.unmountComponentAtNode(this.domElement);
  }

  protected get dataVersion(): Version {
    return Version.parse('1.0');
  }

  protected getPropertyPaneConfiguration(): IPropertyPaneConfiguration {
    return {
      pages: [
        {
          header: {
            description: 'Configure the Power BI report to embed in this web part.'
          },
          displayGroupsAsAccordion: true,
          groups: [
            {
              groupName: 'Report Settings',
              groupFields: [
                PropertyPaneTextField('workspaceId', {
                  label: 'Workspace ID',
                  description: 'The Power BI workspace (group) GUID containing the report.',
                  placeholder: 'e.g., 00000000-0000-0000-0000-000000000000'
                }),
                PropertyPaneTextField('reportId', {
                  label: 'Report ID',
                  description: 'The Power BI report GUID to embed.',
                  placeholder: 'e.g., 00000000-0000-0000-0000-000000000000'
                }),
                PropertyPaneTextField('embedUrl', {
                  label: 'Embed URL (optional)',
                  description: 'Override the default embed URL. Leave blank to auto-generate from workspace and report IDs.',
                  placeholder: 'https://app.powerbi.com/reportEmbed?reportId=...'
                })
              ]
            },
            {
              groupName: 'Display Options',
              groupFields: [
                PropertyPaneToggle('filterPaneEnabled', {
                  label: 'Show Filter Pane',
                  onText: 'Visible',
                  offText: 'Hidden'
                }),
                PropertyPaneToggle('navContentPaneEnabled', {
                  label: 'Show Page Navigation',
                  onText: 'Visible',
                  offText: 'Hidden'
                })
              ]
            }
          ]
        }
      ]
    };
  }
}
