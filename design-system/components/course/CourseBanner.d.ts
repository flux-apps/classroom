import * as React from 'react';

export interface CourseBannerProps {
  title: string; meta?: string; accent: 'lime' | 'green' | 'orange' | 'magenta' | 'blue' | 'purple' | 'teal';
}
export declare function CourseBanner(props: CourseBannerProps): JSX.Element;
