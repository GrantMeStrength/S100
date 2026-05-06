import React, { useState, useCallback, useRef } from 'react';
import * as wasm from '../wasm/index';
import { useMachineStore } from '../store/machineStore';

const ROWS     = 16;
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

  // Edit state
  const [editingOffset, setEditingOffset] = useState<number | null>(null);
  const [editValue, setEditValue]         = useState('');
  // Offsets that were recently written — flash green briefly
  const [flashSet, setFlashSet] = useState<Set<number>>(new Set());
  const flashTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const refresh = useCallback((addr: number) => {
    if (!wasmReady) return;
    const count = ROWS * ROW_BYTES;
    const buf: number[] = [];
    for (let i = 0; i < count; i++) {
      buf.push(wasm.readMemory((addr + i) & 0xFFFF));
    }
    setBytes(buf);
  }, [wasmReady]);

  React.useEffect(() => {
    if (!running && bytes.length === 0) refresh(baseAddr);
  }, [wasmReady]); // eslint-disable-line

  const goToAddr = () => {
    const cleaned = addrInput.replace(/^0[xX]/, '').replace(/[^0-9a-fA-F]/g, '');
    const parsed  = parseInt(cleaned || '0', 16) & 0xFFFF;
    setBaseAddr(parsed);
    setAddrInput('0x' + hexWord(parsed));
    setEditingOffset(null);
    refresh(parsed);
  };

  const scroll = (delta: number) => {
    const next = (baseAddr + delta * ROW_BYTES) & 0xFFFF;
    setBaseAddr(next);
    setAddrInput('0x' + hexWord(next));
    setEditingOffset(null);
    refresh(next);
  };

  /** Commit the edit at the given offset; optionally advance to the next offset. */
  const commitEdit = useCallback((offset: number, raw: string, nextOffset?: number) => {
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      const val = parseInt(trimmed, 16);
      if (!isNaN(val)) {
        const addr = (baseAddr + offset) & 0xFFFF;
        wasm.writeMemory(addr, val & 0xFF);
        setBytes(prev => {
          const next = [...prev];
          next[offset] = val & 0xFF;
          return next;
        });
        // Flash green
        setFlashSet(prev => new Set(prev).add(offset));
        const existing = flashTimers.current.get(offset);
        if (existing) clearTimeout(existing);
        const t = setTimeout(() => {
          setFlashSet(prev => { const s = new Set(prev); s.delete(offset); return s; });
          flashTimers.current.delete(offset);
        }, 500);
        flashTimers.current.set(offset, t);
      }
    }
    const max = ROWS * ROW_BYTES - 1;
    const next = nextOffset !== undefined ? nextOffset : null;
    setEditingOffset(next !== null && next <= max ? next : null);
    setEditValue(next !== null && next <= max && bytes[next] !== undefined
      ? hexByte(bytes[next]) : '');
  }, [baseAddr, bytes]);

  const startEdit = useCallback((offset: number) => {
    setEditingOffset(offset);
    setEditValue(hexByte(bytes[offset] ?? 0));
  }, [bytes]);

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
      <AutoRefresh auto={autoFollow} editing={editingOffset !== null} baseAddr={baseAddr} refresh={refresh} />
      <div style={{
        flex: 1, overflowY: 'auto',
        fontFamily: 'monospace', fontSize: 11,
        background: '#0d1117', borderRadius: 4, padding: '6px 8px',
        lineHeight: 1.7,
        cursor: 'default',
        userSelect: 'none',
      }}
        onKeyDown={e => {
          if (editingOffset === null) return;
          if (e.key === 'Escape') { setEditingOffset(null); e.stopPropagation(); }
        }}
      >
        {bytes.length === 0 ? (
          <span style={{ color: '#484f58' }}>
            {wasmReady ? 'Click ↻ Refresh to read memory' : 'WASM not ready'}
          </span>
        ) : (
          Array.from({ length: ROWS }, (_, row) => {
            const rowAddr  = (baseAddr + row * ROW_BYTES) & 0xFFFF;
            const rowBytes = bytes.slice(row * ROW_BYTES, row * ROW_BYTES + ROW_BYTES);
            const ascii    = rowBytes.map(b =>
              b >= 0x20 && b < 0x7F ? String.fromCharCode(b) : '·'
            ).join('');

            return (
              <div key={row} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {/* Address */}
                <span style={{ color: '#484f58', minWidth: 38 }}>
                  {hexWord(rowAddr)}:
                </span>

                {/* Hex bytes — individually clickable / editable */}
                <span style={{ display: 'flex', gap: 3, flex: 1 }}>
                  {rowBytes.map((b, bi) => {
                    const offset  = row * ROW_BYTES + bi;
                    const editing = editingOffset === offset;
                    const flashed = flashSet.has(offset);

                    if (editing) {
                      return (
                        <input
                          key={bi}
                          type="text"
                          value={editValue}
                          autoFocus
                          maxLength={2}
                          spellCheck={false}
                          onChange={e => {
                            const v = e.target.value.replace(/[^0-9a-fA-F]/gi, '').slice(0, 2).toUpperCase();
                            setEditValue(v);
                            if (v.length === 2) {
                              // Auto-advance after two digits
                              commitEdit(offset, v, offset + 1);
                            }
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitEdit(offset, editValue);
                            } else if (e.key === 'Tab') {
                              e.preventDefault();
                              commitEdit(offset, editValue, offset + (e.shiftKey ? -1 : 1));
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              setEditingOffset(null);
                            } else if (e.key === 'ArrowRight') {
                              e.preventDefault();
                              commitEdit(offset, editValue, offset + 1);
                            } else if (e.key === 'ArrowLeft') {
                              e.preventDefault();
                              commitEdit(offset, editValue, offset - 1);
                            }
                          }}
                          onFocus={e => e.target.select()}
                          onBlur={() => commitEdit(offset, editValue)}
                          style={{
                            width: 22, height: 18,
                            background: '#1c2128',
                            border: '1px solid #58a6ff',
                            borderRadius: 2,
                            color: '#f0883e',
                            fontSize: 11,
                            fontFamily: 'monospace',
                            textAlign: 'center',
                            padding: 0,
                            outline: 'none',
                            boxSizing: 'border-box',
                          }}
                        />
                      );
                    }

                    return (
                      <span
                        key={bi}
                        onClick={() => startEdit(offset)}
                        title={`0x${hexWord((baseAddr + offset) & 0xFFFF)}`}
                        style={{
                          color: flashed ? '#3fb950' : '#79c0ff',
                          transition: flashed ? 'none' : 'color 0.5s',
                          cursor: 'text',
                          minWidth: 22,
                          textAlign: 'center',
                          borderRadius: 2,
                          padding: '0 1px',
                        }}
                      >
                        {hexByte(b)}
                      </span>
                    );
                  })}
                </span>

                {/* ASCII */}
                <span style={{ color: '#6e7681', minWidth: 112 }}>
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

/** Invisible component: triggers refresh on each render when auto=true and not editing */
function AutoRefresh({ auto, editing, baseAddr, refresh }: {
  auto: boolean; editing: boolean; baseAddr: number; refresh: (a: number) => void;
}) {
  React.useEffect(() => {
    if (auto && !editing) refresh(baseAddr);
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
