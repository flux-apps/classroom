import * as React from 'react';

export interface ToolButtonProps {
  icon: string; label: string; // Spanish
  en?: string; // English, shown under the Spanish label pressed?: boolean; disabled?: boolean; onClick?: () => void;
}
export declare function ToolButton(props: ToolButtonProps): JSX.Element;
