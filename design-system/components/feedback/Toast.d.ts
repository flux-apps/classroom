import * as React from 'react';

export interface ToastProps {
  tone?: 'neutral' | 'success' | 'error' | 'warning' | 'info';
  icon?: string;
  children: React.ReactNode;
}
export declare function Toast(props: ToastProps): JSX.Element;
