import * as React from 'react';

export interface NavItemProps {
  icon: string; label: string; current?: boolean; accent?: 'lime' | 'green' | 'orange' | 'magenta' | 'blue' | 'purple' | 'teal'; onClick?: () => void;
}
export declare function NavItem(props: NavItemProps): JSX.Element;
