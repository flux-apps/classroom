import * as React from 'react';

export interface NumberTagProps {
  n: number | string;
  ring?: string;
  style?: React.CSSProperties;
}

export function NumberTag(props: NumberTagProps): React.ReactElement;
