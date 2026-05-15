import React from 'react';
import { useMachineStore } from '../store/machineStore';

function RegPair({ hi, lo, hiLabel, loLabel, pairLabel }: {
  hi: number; lo: number; hiLabel: string; loLabel: string; pairLabel: string;
}) {
  const val16 = ((hi << 8) | lo).toString(16).toUpperCase().padStart(4, '0');
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
      <span style={{ color: '#6e7681', fontSize: 11, width: 20, textAlign: 'right', fontFamily: 'monospace' }}>{pairLabel}</span>
      <span style={{ color: '#79c0ff', fontFamily: 'monospace', fontSize: 14, letterSpacing: 0.5 }}>
        {val16}
      </span>
      <span style={{ color: '#484f58', fontSize: 11, fontFamily: 'monospace' }}>
        {hiLabel}={hi.toString(16).toUpperCase().padStart(2, '0')} {loLabel}={lo.toString(16).toUpperCase().padStart(2, '0')}
      </span>
    </div>
  );
}

function Reg16({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
      <span style={{ color: '#6e7681', fontSize: 11, width: 20, textAlign: 'right', fontFamily: 'monospace' }}>{label}</span>
      <span style={{ color: '#79c0ff', fontFamily: 'monospace', fontSize: 14, letterSpacing: 0.5 }}>
        {value.toString(16).toUpperCase().padStart(4, '0')}
      </span>
    </div>
  );
}

function Reg8({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
      <span style={{ color: '#6e7681', fontSize: 11, width: 20, textAlign: 'right', fontFamily: 'monospace' }}>{label}</span>
      <span style={{ color: '#79c0ff', fontFamily: 'monospace', fontSize: 14, letterSpacing: 0.5 }}>
        {value.toString(16).toUpperCase().padStart(2, '0')}
      </span>
    </div>
  );
}

function Flag({ label, value }: { label: string; value: boolean }) {
  return (
    <span style={{
      color: value ? '#3fb950' : '#484f58',
      fontSize: 12,
      fontFamily: 'monospace',
      fontWeight: 'bold',
      padding: '1px 3px',
      background: value ? '#0f2d0f' : 'transparent',
      borderRadius: 2,
    }}>
      {label}
    </span>
  );
}

export function RegisterView() {
  const state = useMachineStore(s => s.machineState);
  if (!state) {
    return <div style={{ color: '#8b949e', fontSize: 12 }}>No CPU state</div>;
  }
  const { cpu } = state;
  const isZ80 = cpu.ix !== undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ color: '#8b949e', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>
        CPU — {isZ80 ? 'Z80' : '8080'}
      </span>

      <div style={{
        display: 'flex', flexDirection: 'column', gap: 4,
        background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, padding: '8px 10px',
      }}>
        {/* Accumulator */}
        <Reg8 label="A" value={cpu.a} />

        {/* Register pairs */}
        <RegPair hi={cpu.b} lo={cpu.c} hiLabel="B" loLabel="C" pairLabel="BC" />
        <RegPair hi={cpu.d} lo={cpu.e} hiLabel="D" loLabel="E" pairLabel="DE" />
        <RegPair hi={cpu.h} lo={cpu.l} hiLabel="H" loLabel="L" pairLabel="HL" />

        {/* Pointer registers */}
        <div style={{ borderTop: '1px solid #21262d', marginTop: 2, paddingTop: 4 }} />
        <Reg16 label="PC" value={cpu.pc} />
        <Reg16 label="SP" value={cpu.sp} />
        {isZ80 && <Reg16 label="IX" value={cpu.ix!} />}
        {isZ80 && <Reg16 label="IY" value={cpu.iy!} />}

        {/* Flags */}
        <div style={{ borderTop: '1px solid #21262d', marginTop: 2, paddingTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Flag label="S"  value={cpu.flags.s}  />
          <Flag label="Z"  value={cpu.flags.z}  />
          <Flag label="AC" value={cpu.flags.ac} />
          <Flag label="P"  value={cpu.flags.p}  />
          <Flag label="CY" value={cpu.flags.cy} />
          <Flag label={isZ80 ? 'IFF1' : 'IE'} value={cpu.interrupts_enabled} />
          {cpu.halted && <span style={{ color: '#f85149', fontSize: 12, fontWeight: 'bold' }}>HALT</span>}
        </div>

        {/* Cycles */}
        <div style={{ borderTop: '1px solid #21262d', marginTop: 2, paddingTop: 4 }}>
          <span style={{ color: '#6e7681', fontSize: 11, fontFamily: 'monospace' }}>
            Cycles: <span style={{ color: '#c9d1d9' }}>{cpu.cycles.toLocaleString()}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
