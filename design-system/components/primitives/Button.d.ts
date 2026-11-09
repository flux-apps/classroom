import * as React from 'react';

export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
  size?: 'default' | 'small' | 'board'; // board = 56px high, for the GX
  icon?: string; // Icon name, shown before the label
  accent?: 'lime' | 'green' | 'orange' | 'magenta' | 'blue' | 'purple' | 'teal'; // only with variant="accent"
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}
export declare function Button(props: ButtonProps): JSX.Element;
