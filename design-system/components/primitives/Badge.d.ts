import * as React from 'react';

export interface BadgeProps {
  tone?: 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'accent';
  accent?: 'lime' | 'green' | 'orange' | 'magenta' | 'blue' | 'purple' | 'teal';
  children: React.ReactNode;
}
export declare function Badge(props: BadgeProps): JSX.Element;
