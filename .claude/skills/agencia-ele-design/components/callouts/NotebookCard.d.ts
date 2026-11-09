import * as React from 'react';

export interface NotebookCardProps {
  children: React.ReactNode;
  width?: string;
  style?: React.CSSProperties;
}

export function NotebookCard(props: NotebookCardProps): React.ReactElement;
