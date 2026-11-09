import React from 'react';
import { IconButton } from '../../components/primitives/IconButton';
import { Button } from '../../components/primitives/Button';
import { Input } from '../../components/forms/Input';
import { TitleTag } from '../../components/primitives/TitleTag';
import { Card } from '../../components/primitives/Card';
import { SectionTab } from '../../components/primitives/SectionTab';
import { OverlayChip } from '../../components/board/OverlayChip';
export function PdfViewer({ page, setPage, onBack }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-canvas-deep)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 72, padding: '0 16px', background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}>
        <Button size="board" variant="secondary" icon="arrow-left" onClick={onBack}>Tablero / Board</Button>
        <strong style={{ fontSize: 'var(--fs-board-title)' }}>Agencia ELE.pdf</strong>
        <span style={{ flex: 1 }} />
        <IconButton size="board" icon="chevron-left" label="Anterior" onClick={() => setPage(Math.max(1, page - 1))} />
        <div style={{ width: 96 }}><Input size="board" value={page} onChange={(e) => setPage(Number(e.target.value) || 1)} /></div><span>/ 48</span>
        <IconButton size="board" icon="chevron-right" label="Siguiente" onClick={() => setPage(Math.min(48, page + 1))} />
        <IconButton size="board" icon="zoom-out" label="Alejar" /><IconButton size="board" icon="zoom-in" label="Acercar" /><IconButton size="board" icon="maximize" label="Ajustar" />
      </div>
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
        <div style={{ position: 'relative', width: 460, height: 560, background: 'var(--color-paper)', boxShadow: 'var(--shadow-dock)' }}>
          <div style={{ padding: '20px 36px' }}><TitleTag accent="green">Unidad 5</TitleTag>
            <Card variant="tinted" accent="orange" title="Gramática"><span className="t-example">Ayer <b>estuve</b> en una fiesta.</span></Card>
            <p className="t-caption" style={{ marginTop: 24 }}>Placeholder: página {page}. La página real viene del PDF. / Placeholder page; the real page is the PDF.</p></div>
          <div style={{ position: 'absolute', right: -14, top: 96 }}><SectionTab accent="green">Gramática</SectionTab></div>
        </div>
      </div>
      <div style={{ minHeight: 64, display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', background: 'var(--surface-card)' }}>
        <OverlayChip state="unknown" /><span className="t-small t-muted">tinta en la página {page} · ink on page {page} · zoom 100%</span>
      </div>
    </div>
  );
}
