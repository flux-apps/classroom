import * as React from 'react';

export interface OverlayChipProps {
  state: 'unknown' | 'on' | 'off'; onClick?: () => void;
}
export declare function OverlayChip(props: OverlayChipProps): JSX.Element;
