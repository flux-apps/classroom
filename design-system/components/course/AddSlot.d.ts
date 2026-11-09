import * as React from 'react';

export interface AddSlotProps {
  accent?: 'lime' | 'green' | 'orange' | 'magenta' | 'blue' | 'purple' | 'teal';
  board?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}
export declare function AddSlot(props: AddSlotProps): JSX.Element;
