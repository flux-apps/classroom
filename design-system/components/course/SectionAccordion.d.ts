import * as React from 'react';

export interface SectionAccordionProps {
  title: string; accent: 'lime' | 'green' | 'orange' | 'magenta' | 'blue' | 'purple' | 'teal'; open?: boolean; onToggle?: () => void; right?: React.ReactNode; children: React.ReactNode;
}
export declare function SectionAccordion(props: SectionAccordionProps): JSX.Element;
