import * as React from 'react';

export interface RunningFooterProps {
  page: number | string;
  pageWords?: string;
  unit?: string;
  align?: 'left' | 'right';
  style?: React.CSSProperties;
}

export function RunningFooter(props: RunningFooterProps): React.ReactElement;
