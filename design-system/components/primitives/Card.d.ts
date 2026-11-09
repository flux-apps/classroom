import * as React from 'react';

export interface CardProps {
  variant?: 'raised' | 'outline' | 'lined' | 'tinted';
  accent?: 'lime' | 'green' | 'orange' | 'magenta' | 'blue' | 'purple' | 'teal'; // tints and colours the title
  title?: string;
  children: React.ReactNode;
}
export declare function Card(props: CardProps): JSX.Element;
