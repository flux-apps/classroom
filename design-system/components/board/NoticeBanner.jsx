import React from 'react';
import { cx } from '../primitives/cx';
import { Icon } from '../primitives/Icon';
import { Button } from '../primitives/Button';
export function NoticeBanner({ es, en, actionLabel, onAction, className }) {
  return (
    <div role="status" className={cx('ds-banner', className)}>
      <Icon name="info" size={28} />
      <div className="ds-banner__text"><span lang="es">{es}</span><span lang="en" className="ds-banner__en">{en}</span></div>
      {actionLabel && <Button variant="secondary" size="board" onClick={onAction}>{actionLabel}</Button>}
    </div>
  );
}
