import React from 'react';
import { cx, accentClass } from '../primitives/cx';
import { Icon } from '../primitives/Icon';
const ICON = { none: 'circle', todo: 'circle', done: 'check', late: 'clock' };
const LABEL = { none: 'Sin estado', todo: 'Marcar como hecha', done: 'Hecha', late: 'Tarde' };
export function CompletionCheck({ state = 'none', accent, onClick, labelled, board, className }) {
  if (labelled) {
    return (
      <button type="button" onClick={onClick} className={cx('ds-donebtn', state === 'done' && 'ds-donebtn--done', state === 'late' && 'ds-donebtn--late', board && 'ds-donebtn--board', accentClass(accent), className)}>
        <Icon name={ICON[state] === 'circle' ? 'circle' : ICON[state]} size={16} />{LABEL[state]}
      </button>
    );
  }
  const Tag = onClick ? 'button' : 'span';
  return <Tag type={onClick ? 'button' : undefined} onClick={onClick} role={onClick ? undefined : 'img'} aria-label={LABEL[state]} className={cx('ds-done', state !== 'none' && 'ds-done--' + state, accentClass(accent), className)}>{(state === 'done' || state === 'late') && <Icon name={ICON[state]} size={14} />}</Tag>;
}
