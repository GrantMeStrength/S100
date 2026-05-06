import React from 'react';
import { useMachineStore } from '../store/machineStore';

function Reg({ label, value, hex = true }: { label: string; value: number; hex?: boolean }) {
  const fmt = hex
    ? value.toString(16).toUpperCase().padStart(label === 'PC' || label === 'SP' ? 4 : 2, '0')
    : String(value);
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
      <span style={{ color: '#8b949e', fontSize: 11, width: 24, textAlign: 'right' }}>{label}</span>
      <span style={{ color: '#79c0ff', fontFamily: 'monospace', fontSize: 13 }}>{fmt}</span>
    </div>
  );
}

function Flag({ label, value }: { label: string; value: boolean }) {
  return (
    <span style={{
      color: value ? '#3fb950' : '#484f58',
      fontSize: 11,
      fontFamily: 'monospace',
      fontWeight: 'bold',
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
      <span style={{ color: '#8b949e', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>CPU — {isZ80 ? 'Z80' : '8080'}</span>

      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Reg label="A"  value={cpu.a} />
          <Reg label="B"  value={cpu.b} />
          <Reg label="C"  value={cpu.c} />
          <Reg label="D"  value={cpu.d} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Reg label="E"  value={cpu.e} />
          <Reg label="H"  value={cpu.h} />
          <Reg label="L"  value={cpu.l} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Reg label="PC" value={cpu.pc} />
          <Reg label="SP" value={cpu.sp} />
          {isZ80 && <Reg label="IX" value={cpu.ix!} />}
          {isZ80 && <Reg label="IY" value={cpu.iy!} />}
          {!isZ80 && <Reg label="CY" value={cpu.cycles} hex={false} />}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        <Flag label="S"  value={cpu.flags.s}  />
        <Flag label="Z"  value={cpu.flags.z}  />
        <Flag label="AC" value={cpu.flags.ac} />
        <Flag label="P"  value={cpu.flags.p}  />
        <Flag label="CY" value={cpu.flags.cy} />
        <Flag label="IE" value={cpu.interrupts_enabled} />
        {cpu.halted && <span style={{ color: '#f85149', fontSize: 11 }}>HALT</span>}
      </div>
    </div>
  );
}
