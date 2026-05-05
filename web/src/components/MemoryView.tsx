import React, { useState, useCallback } from 'react';
import * as wasm from '../wasm/index';
import { useMachineStore } from '../store/machineStore';

const ROWS     = 16;   // rows of 16 bytes = 256 bytes visible
const ROW_BYTES = 16;

function hexByte(n: number) { return n.toString(16).toUpperCase().padStart(2, '0'); }
function hexWord(n: number) { return n.toString(16).toUpperCase().padStart(4, '0'); }

export function MemoryView() {
  const wasmReady  = useMachineStore(s => s.wasmReady);
  const running    = useMachineStore(s => s.running);
  const [baseAddr, setBaseAddr] = useState(0x0000);
  const [addrInput, setAddrInput] = useState('0x0000');
  const [bytes, setBytes]   = useState<number[]>([]);
  const [autoFollow, setAutoFollow] = useState(false);

  const refresh = useCallback((addr: number) => {
    if (!wasmReady) return;
    const count = ROWS * ROW_BYTES;
    const buf: number[] = [];
    for (let i = 0; i < count; i++) {
      buf.push(wasm.readMemory((addr + i) & 0xFFFF));
    }
    setBytes(buf);
  }, [wasmReady]);

  // Refresh on demand via button, or auto on every render if autoFollow
  React.useEffect(() => {
    if (!running && bytes.length === 0) refresh(baseAddr);
  }, [wasmReady]); // eslint-disable-line

  const goToAddr = () => {
    const cleaned = addrInput.replace(/^0[xX]/, '').replace(/[^0-9a-fA-F]/g, '');
    const parsed  = parseInt(cleaned || '0', 16) & 0xFFFF;
    setBaseAddr(parsed);
    setAddrInput('0x' + hexWord(parsed));
    refresh(parsed);
  };

  const scroll = (delta: number) => {
    const next = (baseAddr + delta * ROW_BYTES) & 0xFFFF;
    setBaseAddr(next);
    setAddrInput('0x' + hexWord(next));
    refresh(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0 }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={addrInput}
          onChange={e => setAddrInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') goToAddr(); }}
          onBlur={goToAddr}
          style={{
            width: 72, background: '#0d1117', border: '1px solid #30363d',
            borderRadius: 3, color: '#c9d1d9', padding: '2px 6px',
            fontSize: 11, fontFamily: 'monospace',
          }}
          placeholder="0x0000"
          spellCheck={false}
        />
        <MemBtn onClick={() => scroll(-1)}>▲</MemBtn>
        <MemBtn onClick={() => scroll(1)}>▼</MemBtn>
        <MemBtn onClick={() => scroll(-16)}>▲▲</MemBtn>
        <MemBtn onClick={() => scroll(16)}>▼▼</MemBtn>
        <MemBtn onClick={() => refresh(baseAddr)}>↻ Refresh</MemBtn>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#6e7681', fontSize: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={autoFollow}
            onChange={e => setAutoFollow(e.target.checked)}
            style={{ accentColor: '#79c0ff' }}
          />
          Auto
        </label>
      </div>

      {/* Hex dump */}
      <AutoRefresh auto={autoFollow} baseAddr={baseAddr} refresh={refresh} />
      <div style={{
        flex: 1, overflowY: 'auto',
        fontFamily: 'monospace', fontSize: 11,
        background: '#0d1117', borderRadius: 4, padding: '6px 8px',
        lineHeight: 1.7,
      }}>
        {bytes.length === 0 ? (
          <span style={{ color: '#484f58' }}>
            {wasmReady ? 'Click ↻ Refresh to read memory' : 'WASM not ready'}
          </span>
        ) : (
          Array.from({ length: ROWS }, (_, row) => {
            const addr = (baseAddr + row * ROW_BYTES) & 0xFFFF;
            const rowBytes = bytes.slice(row * ROW_BYTES, row * ROW_BYTES + ROW_BYTES);
            const ascii = rowBytes.map(b =>
              b >= 0x20 && b < 0x7F ? String.fromCharCode(b) : '·'
            ).join('');
            return (
              <div key={row} style={{ display: 'flex', gap: 8 }}>
                <span style={{ color: '#484f58', minWidth: 38 }}>
                  {hexWord(addr)}:
                </span>
                <span style={{ color: '#79c0ff', flex: 1, letterSpacing: 1 }}>
                  {rowBytes.map(b => hexByte(b)).join(' ')}
                </span>
                <span style={{ color: '#6e7681', minWidth: 16 }}>
                  {ascii}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** Invisible component: triggers refresh on each render when auto=true */
function AutoRefresh({ auto, baseAddr, refresh }: {
  auto: boolean; baseAddr: number; refresh: (a: number) => void;
}) {
  React.useEffect(() => {
    if (auto) refresh(baseAddr);
  });
  return null;
}

function MemBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      background: '#21262d', border: '1px solid #30363d', borderRadius: 3,
      color: '#8b949e', fontSize: 10, padding: '2px 7px', cursor: 'pointer',
      fontFamily: 'monospace',
    }}>
      {children}
    </button>
  );
}
