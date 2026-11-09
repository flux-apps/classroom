import * as React from 'react';

export interface IconButtonProps {
  icon: string;
  label: string; // aria-label (required)
  pressed?: boolean; // toggle state
  size?: 'default' | 'board';
  disabled?: boolean;
  onClick?: () => void;
}
export declare function IconButton(props: IconButtonProps): JSX.Element;
