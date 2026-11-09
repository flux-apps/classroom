import * as React from 'react';

export interface GrammarTableProps {
  columns: React.ReactNode[];
  rows: React.ReactNode[][];
  accent?: string;
  width?: string;
  style?: React.CSSProperties;
}

export function GrammarTable(props: GrammarTableProps): React.ReactElement;
