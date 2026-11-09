import * as React from 'react';

export interface ProgressBarProps {
  value: number; // 0-100
  accent?: 'lime' | 'green' | 'orange' | 'magenta' | 'blue' | 'purple' | 'teal';
  label?: string;
}
export declare function ProgressBar(props: ProgressBarProps): JSX.Element;
