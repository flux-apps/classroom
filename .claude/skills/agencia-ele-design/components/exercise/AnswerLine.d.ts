import * as React from 'react';

export interface AnswerLineProps {
  width?: string;
  variant?: 'solid' | 'dotted';
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export function AnswerLine(props: AnswerLineProps): React.ReactElement;
