import * as React from 'react';

export interface SectionTabProps {
  accent: 'lime' | 'green' | 'orange' | 'magenta' | 'blue' | 'purple' | 'teal';
  children: React.ReactNode; // short label
}
export declare function SectionTab(props: SectionTabProps): JSX.Element;
