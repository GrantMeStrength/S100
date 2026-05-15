import React, { useMemo, useCallback, useState } from 'react';
import { useMachineStore } from '../store/machineStore';
import { disassembleBlock } from '../utils/disasm';
import * as wasm from '../wasm/index';

const NUM_LINES = 32;

export function DisassemblerView() {
  const state   = useMachineStore(s => s.machineState);
  const running = useMachineStore(s => s.running);
  const isZ80   = useMachineStore(s => s.slots.some(sl => sl.card === 'cpu_z80'));
  const breakpoints  = useMachineStore(s => s.breakpoints);
  const toggleBp     = useMachineStore(s => s.toggleBreakpoint);

  const pc = state?.cpu.pc ?? 0;

  // Allow user to pin the view to an address instead of following PC
  const [pinnedAddr, setPinnedAddr] = useState<number | null>(null);
  const [addrInput, setAddrInput] = useState('');

  const startAddr = pinnedAddr ?? pc;

  const lines = useMemo(() => {
    try {
      return disassembleBlock(startAddr, NUM_LINES, (a) => wasm.readMemory(a), isZ80 ? 'z80' : '8080');
    } catch {
      return [];
    }
  }, [startAddr, state, isZ80]);

  const handleGo = useCallback(() => {
    const val = parseInt(addrInput, 16);
    if (!isNaN(val) && val >= 0 && val <= 0xFFFF) {
      setPinnedAddr(val);
    }
  }, [addrInput]);

  const handleFollowPC = useCallback(() => {
    setPinnedAddr(null);
    setAddrInput('');
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexShrink: 0 }}>
        <input
          value={addrInput}
          onChange={e => setAddrInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleGo()}
          placeholder="Address (hex)"
          style={{
            background: '#0d1117', border: '1px solid #30363d', borderRadius: 3,
            color: '#c9d1d9', fontSize: 11, fontFamily: 'monospace',
            padding: '3px 6px', width: 90,
          }}
        />
        <button onClick={handleGo} style={tbBtn}>Go</button>
        <button
          onClick={handleFollowPC}
          style={{ ...tbBtn, color: pinnedAddr === null ? '#3fb950' : '#8b949e' }}
        >
          ↻ PC
        </button>
        <span style={{ color: '#6e7681', fontSize: 10, fontFamily: 'monospace', marginLeft: 'auto' }}>
          {isZ80 ? 'Z80' : '8080'}
        </span>
      </div>

      {/* Disassembly listing */}
      <div style={{
        flex: 1, overflow: 'auto',
        background: '#0d1117', border: '1px solid #30363d', borderRadius: 4,
        fontFamily: 'monospace', fontSize: 12, lineHeight: '20px',
      }}>
        {lines.map((line) => {
          const isCurrent = line.addr === pc && !running;
          const hasBp = breakpoints.has(line.addr);
          return (
            <div
              key={line.addr}
              style={{
                display: 'flex',
                padding: '0 8px',
                background: isCurrent ? '#1c2840' : 'transparent',
                borderLeft: isCurrent ? '3px solid #79c0ff' : '3px solid transparent',
                cursor: 'pointer',
              }}
              onClick={() => toggleBp(line.addr)}
              title={hasBp ? 'Remove breakpoint' : 'Set breakpoint'}
            >
              {/* Breakpoint marker */}
              <span style={{ width: 14, flexShrink: 0, color: '#f85149', textAlign: 'center' }}>
                {hasBp ? '●' : ''}
              </span>
              {/* Address */}
              <span style={{ width: 44, flexShrink: 0, color: '#6e7681' }}>
                {line.addr.toString(16).toUpperCase().padStart(4, '0')}
              </span>
              {/* Hex bytes */}
              <span style={{ width: 90, flexShrink: 0, color: '#484f58' }}>
                {line.bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}
              </span>
              {/* Mnemonic */}
              <span style={{ color: isCurrent ? '#e2e4e8' : '#c9d1d9', flex: 1 }}>
                {line.mnemonic}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const tbBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #30363d',
  color: '#8b949e',
  padding: '2px 8px',
  cursor: 'pointer',
  fontSize: 11,
  borderRadius: 3,
  fontFamily: 'monospace',
};
