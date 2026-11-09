import * as React from 'react';

export interface StatPanelProps {
  label: string; value: string; delta?: string; trend?: 'up' | 'down'; progress?: number; accent?: 'lime' | 'green' | 'orange' | 'magenta' | 'blue' | 'purple' | 'teal';
}
export declare function StatPanel(props: StatPanelProps): JSX.Element;
