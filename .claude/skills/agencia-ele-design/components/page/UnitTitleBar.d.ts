import * as React from 'react';

export interface UnitTitleBarProps {
  number: number | string;
  children: React.ReactNode;
  color?: string;
  style?: React.CSSProperties;
}

export function UnitTitleBar(props: UnitTitleBarProps): React.ReactElement;
