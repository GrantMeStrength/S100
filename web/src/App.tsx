import React, { useEffect, useRef, useState } from 'react';
import { useMachineStore } from './store/machineStore';
import { SYSTEM_PRESETS } from './store/machineStore';
import { Terminal } from './components/Terminal';
import { RegisterView } from './components/RegisterView';
import { ChassisView } from './components/ChassisView';
import { CardLibrary } from './components/CardLibrary';
import { BusAnalyzer } from './components/BusAnalyzer';
import { TraceViewer } from './components/TraceViewer';
import { DiskManager } from './components/DiskManager';
import { ProgrammedOutputPanel } from './components/ProgrammedOutputPanel';
import { MemoryView } from './components/MemoryView';

export default function App() {
  const initWasm    = useMachineStore(s => s.initWasm);
  const start       = useMachineStore(s => s.start);
  const stop        = useMachineStore(s => s.stop);
  const reset       = useMachineStore(s => s.reset);
  const warmReset   = useMachineStore(s => s.warmReset);
  const loadPreset  = useMachineStore(s => s.loadPreset);
  const tick        = useMachineStore(s => s.tick);
  const running     = useMachineStore(s => s.running);
  const wasmReady   = useMachineStore(s => s.wasmReady);
  const error       = useMachineStore(s => s.error);
  const mode        = useMachineStore(s => s.mode);
  const slots       = useMachineStore(s => s.slots);

  // Read CPU speed from the cpu_8080 card params
  const cpuCard = slots.find(s => s.card === 'cpu_8080' || s.card.startsWith('cpu_'));
  const cyclesPerSecond = Math.max(1, (cpuCard?.params?.speed_hz as number) ?? 2_000_000);

  const [selectedPreset, setSelectedPreset] = useState(SYSTEM_PRESETS[1].id);
  const [rightTab, setRightTab] = useState<'trace' | 'memory'>('trace');

  const rafRef      = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const accumRef    = useRef<number>(0);

  useEffect(() => { initWasm(); }, [initWasm]);

  // Fractional-accumulator run loop
  useEffect(() => {
    if (!running) return;
    accumRef.current   = 0;
    lastTimeRef.current = 0;

    const loop = (now: number) => {
      const elapsed = lastTimeRef.current ? now - lastTimeRef.current : 16.67;
      lastTimeRef.current = now;
      accumRef.current += cyclesPerSecond * elapsed / 1000;
      const toRun = Math.floor(accumRef.current);
      accumRef.current -= toRun;
      if (toRun > 0) tick(Math.min(toRun, 200_000));
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [running, tick, cyclesPerSecond]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* ── Title bar ─────────────────────────────────────────────────── */}
      <div style={{
        background: '#161b22',
        borderBottom: '1px solid #30363d',
        padding: '6px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexShrink: 0,
      }}>
        <span style={{ color: '#f0883e', fontWeight: 'bold', fontSize: 14, letterSpacing: 2 }}>
          S-100 VIRTUAL WORKBENCH
        </span>
        <span style={{ color: '#8b949e', fontSize: 11 }}>Intel 8080 / CP/M</span>
        {mode === 'cpm' && (
          <span style={{
            background: '#1f6feb33',
            border: '1px solid #1f6feb',
            color: '#79c0ff',
            fontSize: 10,
            padding: '1px 7px',
            borderRadius: 10,
          }}>
            CP/M 2.2
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* System preset selector */}
          <select
            value={selectedPreset}
            onChange={e => setSelectedPreset(e.target.value)}
            disabled={running}
            style={{
              background: '#21262d', border: '1px solid #30363d', borderRadius: 4,
              color: '#c9d1d9', fontSize: 11, fontFamily: 'monospace',
              padding: '3px 6px', cursor: 'pointer', maxWidth: 220,
            }}
          >
            {SYSTEM_PRESETS.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <CtrlBtn
            onClick={() => loadPreset(selectedPreset)}
            color="#79c0ff"
            disabled={!wasmReady}
          >
            ⚙ Load System
          </CtrlBtn>

          {!wasmReady ? (
            <span style={{ color: '#8b949e', fontSize: 12 }}>Loading WASM…</span>
          ) : (
            <>
              <CtrlBtn
                onClick={running ? stop : start}
                color={running ? '#f85149' : '#3fb950'}
                disabled={!wasmReady}
              >
                {running ? '⏹ Stop' : '▶ Run'}
              </CtrlBtn>
              <CtrlBtn onClick={() => { stop(); tick(1); }} disabled={!wasmReady || running} color="#8b949e">
                ⏭ Step
              </CtrlBtn>
              {mode === 'cpm' && (
                <CtrlBtn onClick={warmReset} disabled={!wasmReady} color="#d29922" title="Warm reset — restarts CP/M via its warm boot vector (0x0000), disks unchanged">
                  ↺ Reset
                </CtrlBtn>
              )}
              <CtrlBtn onClick={reset} disabled={!wasmReady} title="Cold reboot — re-injects boot ROM and reboots from disk, disks unchanged">
                ⟳ Reboot
              </CtrlBtn>
            </>
          )}
        </div>
      </div>

      {error && (
        <div style={{
          background: '#2d0f0f',
          borderBottom: '1px solid #f85149',
          padding: '4px 16px',
          color: '#f85149',
          fontSize: 12,
        }}>
          Error: {error}
        </div>
      )}

      {/* ── Main layout ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Column 1: Card library */}
        <div style={{
          width: 220,
          borderRight: '1px solid #30363d',
          padding: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          overflowY: 'auto',
          flexShrink: 0,
        }}>
          <CardLibrary />
        </div>

        {/* Column 2: Chassis + tools */}
        <div style={{
          width: 290,
          borderRight: '1px solid #30363d',
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          overflowY: 'auto',
          flexShrink: 0,
        }}>
          <ChassisView />
          <Divider />
          <RegisterView />
          <ProgrammedOutputPanel />
          <Divider />
          <BusAnalyzer />
          <Divider />
          <DiskManager />
        </div>

        {/* Right column: terminal + tabbed trace/memory */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          padding: 12, gap: 12, overflow: 'hidden',
        }}>
          <Terminal />
          <Divider />
          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #30363d', flexShrink: 0 }}>
            {(['trace', 'memory'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setRightTab(tab)}
                style={{
                  background: 'none', border: 'none', borderBottom: rightTab === tab ? '2px solid #79c0ff' : '2px solid transparent',
                  color: rightTab === tab ? '#c9d1d9' : '#6e7681',
                  fontSize: 11, padding: '4px 12px', cursor: 'pointer',
                  fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1,
                }}
              >
                {tab === 'trace' ? 'Bus Trace' : 'Memory'}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {rightTab === 'trace' ? <TraceViewer /> : <MemoryView />}
          </div>
        </div>
      </div>

      {/* ── Status bar ────────────────────────────────────────────────── */}
      <StatusBar />
    </div>
  );
}

function StatusBar() {
  const state   = useMachineStore(s => s.machineState);
  const running = useMachineStore(s => s.running);
  const cpu     = state?.cpu;

  return (
    <div style={{
      background: '#161b22',
      borderTop: '1px solid #30363d',
      padding: '3px 16px',
      display: 'flex',
      gap: 24,
      fontSize: 11,
      color: '#8b949e',
      flexShrink: 0,
    }}>
      <span>
        <StatusDot color={running ? '#3fb950' : '#8b949e'} />
        {running ? 'Running' : 'Stopped'}
      </span>
      {cpu && (
        <>
          <span>PC: <code style={{ color: '#79c0ff' }}>
            {cpu.pc.toString(16).toUpperCase().padStart(4, '0')}
          </code></span>
          <span>Cycles: <code style={{ color: '#c9d1d9' }}>{cpu.cycles.toLocaleString()}</code></span>
          <span>Bus: <code style={{ color: '#c9d1d9' }}>{(state?.bus_cycles ?? 0).toLocaleString()}</code></span>
        </>
      )}
    </div>
  );
}

function StatusDot({ color }: { color: string }) {
  return (
    <span style={{
      display: 'inline-block',
      width: 7,
      height: 7,
      borderRadius: '50%',
      background: color,
      marginRight: 5,
      verticalAlign: 'middle',
    }} />
  );
}

function Divider() {
  return <div style={{ borderBottom: '1px solid #21262d' }} />;
}

function CtrlBtn({
  onClick, children, color = '#c9d1d9', disabled = false, title,
}: {
  onClick: () => void;
  children: React.ReactNode;
  color?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: '#21262d',
        border: '1px solid #30363d',
        color: disabled ? '#484f58' : color,
        padding: '4px 14px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 12,
        borderRadius: 4,
        fontFamily: 'monospace',
      }}
    >
      {children}
    </button>
  );
}
