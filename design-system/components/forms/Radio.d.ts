import * as React from 'react';

export interface RadioProps {
  label: string; name: string; accent?: 'lime' | 'green' | 'orange' | 'magenta' | 'blue' | 'purple' | 'teal'; checked?: boolean; onChange?: (e) => void; disabled?: boolean;
}
export declare function Radio(props: RadioProps): JSX.Element;
