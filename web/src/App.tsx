import React, { useEffect, useRef, useState, useCallback } from 'react';
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
import { DazzlerDisplay } from './components/DazzlerDisplay';
import { VdmDisplay } from './components/VdmDisplay';
import { DisassemblerView } from './components/DisassemblerView';
import { parseIntelHex, hexLoadSummary } from './utils/intelHex';
import * as wasm from './wasm/index';

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

  // Derive stable selectors from slots to avoid re-renders every tick
  const cpuSpeedHz  = useMachineStore(s => {
    const cpu = s.slots.find(sl => sl.card === 'cpu_8080' || sl.card.startsWith('cpu_'));
    return (cpu?.params?.speed_hz as number) ?? 2_000_000;
  });
  const hasDazzler  = useMachineStore(s => s.slots.some(sl => sl.card === 'dazzler'));
  const hasVdm      = useMachineStore(s => s.slots.some(sl => sl.card === 'vdm'));
  const cpuLabel    = useMachineStore(s => s.slots.some(sl => sl.card === 'cpu_z80') ? 'Zilog Z80' : 'Intel 8080');

  // 0 = unlimited (run as fast as possible each frame)
  const isUnlimited = cpuSpeedHz === 0;
  const cyclesPerSecond = isUnlimited ? 0 : Math.max(1, cpuSpeedHz);

  const savedPreset = localStorage.getItem('s100_preset') ?? SYSTEM_PRESETS[1].id;
  const [selectedPreset, setSelectedPreset] = useState(
    SYSTEM_PRESETS.some(p => p.id === savedPreset) ? savedPreset : SYSTEM_PRESETS[1].id
  );
  const [rightTab, setRightTab] = useState<'disasm' | 'trace' | 'memory'>('disasm');

  // Intel HEX loader
  const hexInputRef = useRef<HTMLInputElement>(null);
  const [hexStatus, setHexStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleHexFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const result = parseIntelHex(text);
      if (!result.ok) {
        setHexStatus({ ok: false, msg: `Parse error line ${result.error.line}: ${result.error.message}` });
      } else {
        const { segments, startAddress } = result.file;
        for (const seg of segments) {
          wasm.loadBinary(seg.address, seg.data);
        }
        if (startAddress !== undefined) {
          wasm.setPC(startAddress);
        }
        setHexStatus({ ok: true, msg: hexLoadSummary(result.file) });
      }
      // Reset input so the same file can be re-loaded
      e.target.value = '';
      setTimeout(() => setHexStatus(null), 5000);
    };
    reader.readAsText(file);
  }, []);

  const rafRef      = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const accumRef    = useRef<number>(0);

  useEffect(() => { initWasm(); }, [initWasm]);

  // Auto-load the saved preset once WASM is ready
  const autoLoadedRef = useRef(false);
  useEffect(() => {
    if (wasmReady && !autoLoadedRef.current) {
      autoLoadedRef.current = true;
      loadPreset(selectedPreset);
    }
  }, [wasmReady, selectedPreset, loadPreset]);

  // Fractional-accumulator run loop
  useEffect(() => {
    if (!running) return;
    accumRef.current   = 0;
    lastTimeRef.current = 0;

    const loop = (now: number) => {
      if (isUnlimited) {
        // Unlimited: run max cycles every frame
        tick(200_000);
      } else {
        const elapsed = lastTimeRef.current ? now - lastTimeRef.current : 16.67;
        lastTimeRef.current = now;
        accumRef.current += cyclesPerSecond * elapsed / 1000;
        const toRun = Math.floor(accumRef.current);
        accumRef.current -= toRun;
        if (toRun > 0) tick(Math.min(toRun, 200_000));
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [running, tick, cyclesPerSecond, isUnlimited]);

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
        <span style={{ color: '#8b949e', fontSize: 11 }}>
          {cpuLabel}
        </span>
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
              color: running ? '#484f58' : '#c9d1d9', fontSize: 11, fontFamily: 'monospace',
              padding: '3px 6px', cursor: running ? 'not-allowed' : 'pointer', maxWidth: 220,
              opacity: running ? 0.5 : 1,
            }}
          >
            {SYSTEM_PRESETS.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <CtrlBtn
            onClick={() => { localStorage.setItem('s100_preset', selectedPreset); loadPreset(selectedPreset); }}
            color="#79c0ff"
            disabled={!wasmReady || running}
          >
            ⚙ Load
          </CtrlBtn>

          <ToolbarSep />

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

              <ToolbarSep />

              {/* Intel HEX loader */}
              <input
                ref={hexInputRef}
                type="file"
                accept=".hex,.ihx,.h86"
                style={{ display: 'none' }}
                onChange={handleHexFile}
              />
              <CtrlBtn
                onClick={() => hexInputRef.current?.click()}
                disabled={!wasmReady}
                color="#a371f7"
                title="Load an Intel HEX file into memory. If the file specifies a start address, the PC will be set automatically."
              >
                ↑ Load HEX
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

      {hexStatus && (
        <div style={{
          background: hexStatus.ok ? '#0d2817' : '#2d0f0f',
          borderBottom: `1px solid ${hexStatus.ok ? '#3fb950' : '#f85149'}`,
          padding: '4px 16px',
          color: hexStatus.ok ? '#3fb950' : '#f85149',
          fontSize: 12,
          fontFamily: 'monospace',
        }}>
          {hexStatus.ok ? '✓ HEX loaded — ' : '✗ '}{hexStatus.msg}
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
          <MachinePhoto presetId={selectedPreset} />
          <Divider />
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
          {hasDazzler && (
            <>
              <Divider />
              <DazzlerDisplay />
            </>
          )}
          {hasVdm && (
            <>
              <Divider />
              <VdmDisplay />
            </>
          )}
          <Divider />
          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #30363d', flexShrink: 0 }}>
            {(['disasm', 'trace', 'memory'] as const).map(tab => (
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
                {tab === 'disasm' ? 'Disassembly' : tab === 'trace' ? 'Bus Trace' : 'Memory'}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {rightTab === 'disasm' ? <DisassemblerView /> : rightTab === 'trace' ? <TraceViewer /> : <MemoryView />}
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

function ToolbarSep() {
  return (
    <div style={{
      width: 1,
      height: 18,
      background: '#30363d',
      flexShrink: 0,
    }} />
  );
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

function MachinePhoto({ presetId }: { presetId: string }) {
  const isSol20 = presetId.startsWith('sol20');
  const isImsai = presetId.startsWith('imsai');
  const src   = isSol20 ? `${import.meta.env.BASE_URL}images/sol20.jpg`
              : isImsai ? `${import.meta.env.BASE_URL}images/imsai8080.jpg`
              :            `${import.meta.env.BASE_URL}images/altair8800.png`;
  const label = isSol20 ? 'Processor Technology SOL-20'
              : isImsai ? 'IMSAI 8080'
              :            'Altair 8800';

  return (
    <div style={{ paddingBottom: 4 }}>
      <img
        src={src}
        alt={label}
        style={{
          width: '100%',
          borderRadius: 6,
          border: '1px solid #30363d',
          opacity: 0.85,
          display: 'block',
        }}
      />
      <div style={{
        textAlign: 'center',
        color: '#6e7681',
        fontSize: 10,
        marginTop: 4,
        fontFamily: 'monospace',
        letterSpacing: 1,
      }}>
        {label}
      </div>
    </div>
  );
}
