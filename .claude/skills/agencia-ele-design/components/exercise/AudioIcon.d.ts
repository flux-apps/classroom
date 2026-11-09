import * as React from 'react';

export interface AudioIconProps {
  track: number | string;
  size?: string;
  style?: React.CSSProperties;
}

export function AudioIcon(props: AudioIconProps): React.ReactElement;
