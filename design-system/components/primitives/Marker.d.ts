import * as React from 'react';

export interface MarkerProps {
  accent: 'lime' | 'green' | 'orange' | 'magenta' | 'blue' | 'purple' | 'teal';
  shape?: 'circle'|'square'|'triangle'|'diamond'|'hexagon'|'pentagon'|'cross'; // default: the accent's own shape
  large?: boolean;
}
export declare function Marker(props: MarkerProps): JSX.Element;
