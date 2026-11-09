import * as React from 'react';

export interface ObjectCardProps {
  kind: 'pdf' | 'image' | 'link';
  title: string; meta?: string; accent?: 'lime' | 'green' | 'orange' | 'magenta' | 'blue' | 'purple' | 'teal';
  selected?: boolean; failed?: boolean;
  actionLabel?: string; onAction?: () => void;
  tabLabel?: string;
}
export declare function ObjectCard(props: ObjectCardProps): JSX.Element;
