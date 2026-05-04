import React, { useEffect, useRef } from 'react';
import { useMachineStore } from './store/machineStore';
import { Terminal } from './components/Terminal';
import { RegisterView } from './components/RegisterView';
import { ChassisView } from './components/ChassisView';
import { CardLibrary } from './components/CardLibrary';
import { BusAnalyzer } from './components/BusAnalyzer';
import { TraceViewer } from './components/TraceViewer';
import { DiskManager } from './components/DiskManager';

// Speed presets: label → cycles/second (0 = manual step)
const SPEED_PRESETS = [
  { label: '1 Hz',   hz: 1 },
  { label: '10 Hz',  hz: 10 },
  { label: '100 Hz', hz: 100 },
  { label: '1 kHz',  hz: 1_000 },
  { label: '10 kHz', hz: 10_000 },
  { label: '100 kHz',hz: 100_000 },
  { label: '1 MHz',  hz: 1_000_000 },
  { label: '2 MHz',  hz: 2_000_000 },
] as const;

export default function App() {
  const initWasm  = useMachineStore(s => s.initWasm);
  const start     = useMachineStore(s => s.start);
  const stop      = useMachineStore(s => s.stop);
  const reset     = useMachineStore(s => s.reset);
  const bootCpm   = useMachineStore(s => s.bootCpm);
  const tick      = useMachineStore(s => s.tick);
  const running   = useMachineStore(s => s.running);
  const wasmReady = useMachineStore(s => s.wasmReady);
  const error     = useMachineStore(s => s.error);
  const mode      = useMachineStore(s => s.mode);

  // Speed state: index into SPEED_PRESETS
  const [speedIdx, setSpeedIdx] = React.useState(SPEED_PRESETS.length - 1); // default 2 MHz
  const cyclesPerSecond = SPEED_PRESETS[speedIdx].hz;

  const rafRef         = useRef<number>(0);
  const lastTimeRef    = useRef<number>(0);
  const accumRef       = useRef<number>(0); // fractional cycle accumulator

  // Initialize WASM on mount
  useEffect(() => { initWasm(); }, [initWasm]);

  // Run loop — fractional accumulator for accurate slow speeds
  useEffect(() => {
    if (!running) return;
    accumRef.current  = 0;
    lastTimeRef.current = 0;

    const loop = (now: number) => {
      const elapsed = lastTimeRef.current ? now - lastTimeRef.current : 16.67;
      lastTimeRef.current = now;

      accumRef.current += cyclesPerSecond * elapsed / 1000;
      const toRun = Math.floor(accumRef.current);
      accumRef.current -= toRun;

      if (toRun > 0) {
        // Cap per-frame burst so the UI stays responsive at high speeds
        tick(Math.min(toRun, 200_000));
      }
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
          {/* Speed control */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ color: '#484f58', fontSize: 10, fontFamily: 'monospace' }}>CPU</span>
            <select
              value={speedIdx}
              onChange={e => setSpeedIdx(Number(e.target.value))}
              style={{
                background: '#21262d',
                border: '1px solid #30363d',
                borderRadius: 4,
                color: '#c9d1d9',
                fontSize: 11,
                fontFamily: 'monospace',
                padding: '2px 4px',
                cursor: 'pointer',
              }}
            >
              {SPEED_PRESETS.map((p, i) => (
                <option key={i} value={i}>{p.label}</option>
              ))}
            </select>
          </div>

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
              <CtrlBtn onClick={reset} disabled={!wasmReady}>⟳ Reset</CtrlBtn>
              <CtrlBtn
                onClick={bootCpm}
                color="#79c0ff"
                disabled={!wasmReady || running}
              >
                ⚙ Boot CP/M
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
          <Divider />
          <BusAnalyzer />
          <Divider />
          <DiskManager />
        </div>

        {/* Right column: terminal + trace */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: 12,
          gap: 12,
          overflow: 'hidden',
        }}>
          <Terminal />
          <Divider />
          <TraceViewer />
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
  onClick, children, color = '#c9d1d9', disabled = false,
}: {
  onClick: () => void;
  children: React.ReactNode;
  color?: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
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
