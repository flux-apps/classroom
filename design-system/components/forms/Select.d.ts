import * as React from 'react';

export interface SelectProps {
  options: { value: string; label: string }[];
  value?: string; onChange?: (e) => void; disabled?: boolean;
}
export declare function Select(props: SelectProps): JSX.Element;
