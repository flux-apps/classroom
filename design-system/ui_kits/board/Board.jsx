import React from 'react';
import { NoticeBanner } from '../../components/board/NoticeBanner';
import { ToolDock } from '../../components/board/ToolDock';
import { ToolButton } from '../../components/board/ToolButton';
import { ZoomControl } from '../../components/board/ZoomControl';
import { ObjectCard } from '../../components/board/ObjectCard';
import { StickyNote } from '../../components/board/StickyNote';
import { Frame } from '../../components/board/Frame';
import { OverlayChip } from '../../components/board/OverlayChip';
import { Badge } from '../../components/primitives/Badge';
const NEXT = { unknown: 'on', on: 'off', off: 'unknown' };
export function Board({ onOpenBook, onClear, onSave }) {
  const [tool, setTool] = React.useState('pen');
  const [zoom, setZoom] = React.useState(100);
  const [overlay, setOverlay] = React.useState('unknown');
  const [notice, setNotice] = React.useState(true);
  const [selected, setSelected] = React.useState('pdf');
  const T = (id, icon, label, en) => <ToolButton icon={icon} label={label} en={en} pressed={tool === id} onClick={() => setTool(id)} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {notice && <NoticeBanner es="Este tablero pinta con el lápiz de la app, no con Overlay. Overlay puede estar ON: no hace falta apagarlo." en="This board draws with the in-app pen, not Overlay. Overlay may be ON: you do not need to turn it off." actionLabel="Entendido / Got it" onAction={() => setNotice(false)} />}
      <div className="surface-board" style={{ flex: 1, position: 'relative', overflow: 'hidden' }} onClick={() => setSelected(null)}>
        <div style={{ position: 'absolute', top: 16, left: 16, right: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }} onClick={(e) => e.stopPropagation()}>
          <ToolDock>
            {T('select', 'mouse-pointer-2', 'Elegir', 'Select')}{T('pen', 'pen', 'Lápiz', 'Pen')}{T('eraser', 'eraser', 'Goma', 'Eraser')}{T('text', 'type', 'Texto', 'Text')}
            <ToolDock.Sep />
            <ToolButton icon="image" label="Imagen" en="Image" /><ToolButton icon="file-up" label="PDF" en="PDF" /><ToolButton icon="link" label="Enlace" en="Link" />
          </ToolDock>
          <ToolDock>
            <ToolButton icon="undo-2" label="Deshacer" en="Undo" /><ToolButton icon="redo-2" label="Rehacer" en="Redo" />
            <ToolDock.Sep />
            <ToolButton icon="save" label="Guardar" en="Save" onClick={onSave} /><ToolButton icon="trash-2" label="Borrar" en="Clear" onClick={onClear} />
          </ToolDock>
        </div>
        <div style={{ position: 'absolute', left: 48, top: 150 }} onClick={(e) => { e.stopPropagation(); setSelected('pdf'); }}>
          <ObjectCard kind="pdf" selected={selected === 'pdf'} title="Agencia ELE.pdf" meta="48 pp · p.12 · tinta / ink" accent="green" tabLabel="Libro" actionLabel="Abrir libro / Open book" onAction={onOpenBook} />
        </div>
        <div style={{ position: 'absolute', left: 380, top: 150 }} onClick={(e) => { e.stopPropagation(); setSelected('link'); }}>
          <ObjectCard kind="link" selected={selected === 'link'} title="Diccionario de la RAE" meta="dle.rae.es" accent="blue" actionLabel="Abrir en pestaña ↗" />
        </div>
        <div style={{ position: 'absolute', left: 700, top: 150 }}><Frame title="1 · Calentamiento" width={300} height={220}>
          <div style={{ padding: 20 }}><StickyNote flat color="green" accent="green">Ayer yo estuve en…</StickyNote></div></Frame></div>
        <div style={{ position: 'absolute', left: 1020, top: 170 }}><StickyNote accent="orange">¡Hoy: el pretérito indefinido!</StickyNote></div>
        <div style={{ position: 'absolute', right: 16, bottom: 88 }}><ZoomControl value={zoom} onZoomIn={() => setZoom(Math.min(300, zoom + 25))} onZoomOut={() => setZoom(Math.max(25, zoom - 25))} onFit={() => setZoom(100)} /></div>
        <div style={{ position: 'absolute', left: 16, bottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
          <OverlayChip state={overlay} onClick={() => setOverlay(NEXT[overlay])} />
          <Badge>herramienta: {tool}</Badge><Badge tone="warning">pen/touch: provisional</Badge><Badge tone="info">• sin guardar / unsaved</Badge>
        </div>
      </div>
    </div>
  );
}
