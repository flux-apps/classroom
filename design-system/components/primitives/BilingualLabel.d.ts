import * as React from 'react';

export interface BilingualLabelProps {
  es: string;
  en: string;
  inline?: boolean; // side by side instead of stacked
  onDark?: boolean;
}
export declare function BilingualLabel(props: BilingualLabelProps): JSX.Element;
