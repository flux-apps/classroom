import * as React from 'react';

export interface StickyNoteProps {
  tone?: 'rose' | 'sun' | 'teal';
  tilt?: number;
  children: React.ReactNode;
  width?: string;
  style?: React.CSSProperties;
}

export function StickyNote(props: StickyNoteProps): React.ReactElement;
