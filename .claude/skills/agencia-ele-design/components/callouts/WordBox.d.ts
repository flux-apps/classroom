import * as React from 'react';

export interface WordBoxProps {
  items: React.ReactNode[];
  color?: string;
  width?: string;
  style?: React.CSSProperties;
}

export function WordBox(props: WordBoxProps): React.ReactElement;
