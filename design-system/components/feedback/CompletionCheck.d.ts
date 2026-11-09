import * as React from 'react';

export interface CompletionCheckProps {
  state: 'none' | 'todo' | 'done' | 'late';
  labelled?: boolean; // pill button with text + icon (Moodle 'Mark as done')
  board?: boolean; // 56px high for the board
  onClick?: () => void; // makes it a toggle button
  accent?: 'lime' | 'green' | 'orange' | 'magenta' | 'blue' | 'purple' | 'teal';
}
export declare function CompletionCheck(props: CompletionCheckProps): JSX.Element;
