import * as React from 'react';

export interface StickyNoteProps {
  color?: 'yellow' | 'green' | 'teal' | 'pink' | 'lavender';
  flat?: boolean; // no tilt
  children: React.ReactNode;
}
export declare function StickyNote(props: StickyNoteProps): JSX.Element;
