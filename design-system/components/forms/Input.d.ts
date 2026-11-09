import * as React from 'react';

export interface InputProps {
  size?: 'default' | 'board';
  invalid?: boolean;
  placeholder?: string;
  value?: string; onChange?: (e) => void; disabled?: boolean;
}
export declare function Input(props: InputProps): JSX.Element;
