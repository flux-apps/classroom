import * as React from 'react';

export interface ZoomControlProps {
  value: number; // percent
  onZoomIn?: () => void; onZoomOut?: () => void; onFit?: () => void;
}
export declare function ZoomControl(props: ZoomControlProps): JSX.Element;
