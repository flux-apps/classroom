import * as React from 'react';

export interface SwitchProps {
  label: string; accent?: 'lime' | 'green' | 'orange' | 'magenta' | 'blue' | 'purple' | 'teal'; checked?: boolean; onChange?: (e) => void; disabled?: boolean;
}
export declare function Switch(props: SwitchProps): JSX.Element;
