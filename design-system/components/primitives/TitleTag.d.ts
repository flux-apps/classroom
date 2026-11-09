import * as React from 'react';

export interface TitleTagProps {
  accent: 'lime' | 'green' | 'orange' | 'magenta' | 'blue' | 'purple' | 'teal';
  children: React.ReactNode;
}
export declare function TitleTag(props: TitleTagProps): JSX.Element;
