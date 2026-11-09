import * as React from 'react';

export interface FrameProps {
  title: string; width?: number | string; height?: number | string; children?: React.ReactNode;
}
export declare function Frame(props: FrameProps): JSX.Element;
