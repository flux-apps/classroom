import * as React from 'react';

export interface BubbleProps {
  size?: string;
  tint?: 'sun' | 'teal' | 'rose' | 'lavender';
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export function Bubble(props: BubbleProps): React.ReactElement;
