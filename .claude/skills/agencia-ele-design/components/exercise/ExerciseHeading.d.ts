import * as React from 'react';

export interface ExerciseHeadingProps {
  number: number | string;
  children: React.ReactNode;
  accent?: string;
  style?: React.CSSProperties;
}

export function ExerciseHeading(props: ExerciseHeadingProps): React.ReactElement;
