import * as React from 'react';

export interface NoticeBannerProps {
  es: React.ReactNode; en: React.ReactNode; actionLabel?: string; onAction?: () => void;
}
export declare function NoticeBanner(props: NoticeBannerProps): JSX.Element;
