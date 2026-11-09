import * as React from 'react';

export interface TabsProps {
  tabs: { id: string; label: string }[];
  value: string; onChange: (id: string) => void; accent?: 'lime' | 'green' | 'orange' | 'magenta' | 'blue' | 'purple' | 'teal';
}
export declare function Tabs(props: TabsProps): JSX.Element;
