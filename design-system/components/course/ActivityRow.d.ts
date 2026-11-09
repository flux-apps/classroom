import * as React from 'react';

export interface ActivityRowProps {
  icon: string; name: string; due?: string; state?: 'none'|'todo'|'done'|'late'; onToggle?: () => void;
  accent?: 'lime' | 'green' | 'orange' | 'magenta' | 'blue' | 'purple' | 'teal';
}
export declare function ActivityRow(props: ActivityRowProps): JSX.Element;
