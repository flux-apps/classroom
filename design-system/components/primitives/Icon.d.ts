import * as React from 'react';

export interface IconProps {
  name: string; // file name in assets/icons, e.g. "pen"
  size?: number; // px, default 24
  className?: string;
}
export declare function Icon(props: IconProps): JSX.Element;
