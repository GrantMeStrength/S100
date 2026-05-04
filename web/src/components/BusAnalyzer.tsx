import React from 'react';
import { useMachineStore } from '../store/machineStore';

function Led({ on, color = '#3fb950' }: { on: boolean; color?: string }) {
  return (
    <div style={{
      width: 10,
      height: 10,
      borderRadius: '50%',
      background: on ? color : '#21262d',
      boxShadow: on ? `0 0 4px ${color}` : 'none',
      display: 'inline-block',
    }} />
  );
}

function AddrBus({ addr }: { addr: number }) {
  const bits = Array.from({ length: 16 }, (_, i) => !!(addr & (1 << (15 - i))));
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
      <span style={{ color: '#8b949e', fontSize: 10, marginRight: 4, width: 24 }}>ADDR</span>
      {bits.map((b, i) => (
        <Led key={i} on={b} color="#79c0ff" />
      ))}
      <span style={{ color: '#79c0ff', fontSize: 11, marginLeft: 6, fontFamily: 'monospace' }}>
        {addr.toString(16).toUpperCase().padStart(4, '0')}
      </span>
    </div>
  );
}

function DataBus({ data }: { data: number }) {
  const bits = Array.from({ length: 8 }, (_, i) => !!(data & (1 << (7 - i))));
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
      <span style={{ color: '#8b949e', fontSize: 10, marginRight: 4, width: 24 }}>DATA</span>
      {bits.map((b, i) => (
        <Led key={i} on={b} color="#3fb950" />
      ))}
      <span style={{ color: '#3fb950', fontSize: 11, marginLeft: 6, fontFamily: 'monospace' }}>
        {data.toString(16).toUpperCase().padStart(2, '0')}
      </span>
    </div>
  );
}

export function BusAnalyzer() {
  const entries = useMachineStore(s => s.traceEntries);
  const last = entries[entries.length - 1];

  const opColor = (op: string) => {
    if (op === 'MemRead')  return '#79c0ff';
    if (op === 'MemWrite') return '#ffa657';
    if (op === 'IoRead')   return '#a5f3d4';
    if (op === 'IoWrite')  return '#f0883e';
    return '#8b949e';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ color: '#8b949e', fontSize: 12 }}>BUS ANALYZER</span>

      {/* LED bus display */}
      <div style={{
        background: '#0d1117',
        border: '1px solid #30363d',
        borderRadius: 4,
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
        <AddrBus addr={last?.address ?? 0} />
        <DataBus data={last?.data ?? 0} />

        <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
          {(['MemRead','MemWrite','IoRead','IoWrite'] as const).map(op => (
            <div key={op} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Led on={last?.op === op} color={opColor(op)} />
              <span style={{ color: '#8b949e', fontSize: 10 }}>{op}</span>
            </div>
          ))}
          <span style={{ color: '#8b949e', fontSize: 10, marginLeft: 8 }}>
            src: <span style={{ color: '#c9d1d9' }}>{last?.source ?? '—'}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
