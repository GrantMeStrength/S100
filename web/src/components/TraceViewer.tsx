import React, { useMemo } from 'react';
import { useMachineStore } from '../store/machineStore';
import type { TraceEntry } from '../wasm/index';

function opBadge(op: TraceEntry['op']) {
  const map: Record<TraceEntry['op'], [string, string]> = {
    MemRead:  ['MR', '#79c0ff'],
    MemWrite: ['MW', '#ffa657'],
    IoRead:   ['IR', '#a5f3d4'],
    IoWrite:  ['IW', '#f0883e'],
  };
  const [label, color] = map[op];
  return (
    <span style={{
      color,
      fontSize: 10,
      fontFamily: 'monospace',
      fontWeight: 'bold',
      width: 20,
      display: 'inline-block',
    }}>
      {label}
    </span>
  );
}

export function TraceViewer() {
  const entries = useMachineStore(s => s.traceEntries);
  // Show last 64 entries reversed (newest at top)
  const visible = useMemo(() => [...entries].reverse().slice(0, 64), [entries]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ color: '#8b949e', fontSize: 12 }}>BUS TRACE</span>
      <div style={{
        background: '#0d1117',
        border: '1px solid #30363d',
        borderRadius: 4,
        padding: '4px 0',
        height: 200,
        overflowY: 'auto',
        fontFamily: 'monospace',
        fontSize: 11,
      }}>
        {visible.map((e, i) => (
          <div key={i} style={{
            padding: '1px 8px',
            display: 'flex',
            gap: 8,
            borderBottom: '1px solid #161b22',
            alignItems: 'center',
          }}>
            <span style={{ color: '#484f58', minWidth: 48 }}>
              {e.cycle.toString().padStart(8, ' ')}
            </span>
            {opBadge(e.op)}
            <span style={{ color: '#79c0ff', minWidth: 44 }}>
              {e.address.toString(16).toUpperCase().padStart(4, '0')}
            </span>
            <span style={{ color: '#3fb950', minWidth: 20 }}>
              {e.data.toString(16).toUpperCase().padStart(2, '0')}
            </span>
            <span style={{ color: '#8b949e', fontSize: 10 }}>{e.source}</span>
          </div>
        ))}
        {visible.length === 0 && (
          <div style={{ padding: 8, color: '#484f58', fontSize: 11 }}>
            No trace entries yet. Start the machine to see bus activity.
          </div>
        )}
      </div>
    </div>
  );
}
