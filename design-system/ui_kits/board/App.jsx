import React from 'react';
import { Board } from './Board';
import { PdfViewer } from './PdfViewer';
import { Dialog } from '../../components/feedback/Dialog';
import { Toast } from '../../components/feedback/Toast';
import { Button } from '../../components/primitives/Button';
export function App() {
  const [screen, setScreen] = React.useState('board');
  const [page, setPage] = React.useState(12);
  const [confirm, setConfirm] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const say = (t) => { setToast(t); setTimeout(() => setToast(null), 2200); };
  return (
    <div style={{ position: 'relative', height: '100%', overflow: 'hidden' }}>
      {screen === 'board'
        ? <Board onOpenBook={() => setScreen('pdf')} onClear={() => setConfirm(true)} onSave={() => say('Guardada / Saved')} />
        : <PdfViewer page={page} setPage={setPage} onBack={() => setScreen('board')} />}
      {confirm && (
        <Dialog title="¿Borrar el tablero? / Clear board?" onClose={() => setConfirm(false)}
          actions={<><Button size="board" variant="ghost" onClick={() => setConfirm(false)}>Cancelar / Cancel</Button><Button size="board" variant="danger" onClick={() => { setConfirm(false); say('Tablero borrado / Board cleared'); }}>Borrar / Clear</Button></>}>
          Se perderán los objetos y la tinta. / Objects and ink will be lost.
        </Dialog>)}
      {toast && <div style={{ position: 'absolute', left: '50%', bottom: 96, transform: 'translateX(-50%)' }}><Toast tone="success" icon="circle-check">{toast}</Toast></div>}
    </div>
  );
}
