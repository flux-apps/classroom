import * as React from 'react';

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}
export declare function Field(props: FieldProps): JSX.Element;
