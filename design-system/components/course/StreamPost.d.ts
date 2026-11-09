import * as React from 'react';

export interface StreamPostProps {
  icon: string; title: string; meta?: string; side?: string; accent?: 'lime' | 'green' | 'orange' | 'magenta' | 'blue' | 'purple' | 'teal';
}
export declare function StreamPost(props: StreamPostProps): JSX.Element;
