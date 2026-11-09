import * as React from 'react';

export interface SectionTabProps {
  side?: 'left' | 'right';
  color?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export function SectionTab(props: SectionTabProps): React.ReactElement;
