import * as React from 'react';

export interface TagProps {
  accent?: 'lime' | 'green' | 'orange' | 'magenta' | 'blue' | 'purple' | 'teal';
  onRemove?: () => void; // shows the x button when set
  children: React.ReactNode;
}
export declare function Tag(props: TagProps): JSX.Element;
