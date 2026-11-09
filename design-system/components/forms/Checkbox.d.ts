import * as React from 'react';

export interface CheckboxProps {
  label: string; accent?: 'lime' | 'green' | 'orange' | 'magenta' | 'blue' | 'purple' | 'teal'; checked?: boolean; onChange?: (e) => void; disabled?: boolean;
}
export declare function Checkbox(props: CheckboxProps): JSX.Element;
