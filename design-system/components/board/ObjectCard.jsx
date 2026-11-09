import React from 'react';
import { cx, accentClass } from '../primitives/cx';
import { Icon } from '../primitives/Icon';
import { Button } from '../primitives/Button';
import { SectionTab } from '../primitives/SectionTab';
const ICON = { pdf: 'file-text', image: 'image', link: 'link' };
export function ObjectCard({ kind, title, meta, accent, selected, failed, actionLabel, onAction, tabLabel, className }) {
  return (
    <div className={cx('ds-object', selected && 'ds-object--selected', failed && 'ds-object--failed', accentClass(accent), className)}>
      <div className="ds-object__thumb">
        <Icon name={failed ? 'triangle-alert' : ICON[kind]} size={48} />
        {tabLabel && <div className="ds-object__tab"><SectionTab accent={accent}>{tabLabel}</SectionTab></div>}
      </div>
      <div className="ds-object__body">
        <span className="ds-object__title">{title}</span>
        {meta && <span className="ds-object__meta">{meta}</span>}
        {actionLabel && <div className="ds-object__action"><Button variant="accent" accent={accent} size="small" onClick={onAction}>{actionLabel}</Button></div>}
      </div>
    </div>
  );
}
