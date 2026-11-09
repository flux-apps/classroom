import * as React from 'react';

export interface DialogProps {
  title: string;
  onClose?: () => void;
  actions?: React.ReactNode; // footer buttons
  children: React.ReactNode;
}
export declare function Dialog(props: DialogProps): JSX.Element;
