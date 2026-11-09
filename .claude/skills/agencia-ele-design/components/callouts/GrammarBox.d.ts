import * as React from 'react';

export interface GrammarBoxProps {
  title?: React.ReactNode;
  tint?: string;
  accent?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export function GrammarBox(props: GrammarBoxProps): React.ReactElement;
