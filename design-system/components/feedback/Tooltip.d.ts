import * as React from 'react';

export interface TooltipProps {
  text: string; open?: boolean (force visible, for docs); children: React.ReactNode;
}
export declare function Tooltip(props: TooltipProps): JSX.Element;
