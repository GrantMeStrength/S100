import React, { useRef, useState } from 'react';
import { useMachineStore } from '../store/machineStore';

const DRIVE_LABELS = ['A', 'B', 'C', 'D'];

// ── Disk compatibility data ────────────────────────────────────────────────────

interface DiskSource {
  label: string;
  url?: string;
  notes: string;
}

interface MachineCompat {
  cards: string[];         // card IDs that trigger this entry
  title: string;
  format: string;
  size: string;
  sources: DiskSource[];
}

const COMPAT_TABLE: MachineCompat[] = [
  {
    cards: ['dcdd_88'],
    title: 'Altair 8800 — MITS 88-DCDD controller',
    format: '88-DCDD hard-sector (77 × 32 × 137 bytes = 337,568 bytes)',
    size: '337,568 bytes',
    sources: [
      {
        label: 'SIMH Altair CP/M archives (schorn.ch)',
        url: 'https://schorn.ch/cpm/zip/Altair8800.zip',
        notes: 'Official SIMH disk image set. Download AltairCPM22.dsk etc. These are the canonical Altair images.',
      },
      {
        label: 'SIMH trailing-edge.com software page',
        url: 'http://simh.trailing-edge.com/software.html',
        notes: 'Additional SIMH disk archives including Altair BASIC and CP/M.',
      },
    ],
  },
  {
    cards: ['fdc_fif', 'fdc_wd1793', 'fdc'],
    title: 'IMSAI / Cromemco — FIF · WD1793 · legacy FDC',
    format: 'Flat raw IBM 3740 SSSD (77 × 26 × 128 bytes = 256,256 bytes)',
    size: '256,256 bytes',
    sources: [
      {
        label: 'Your own IMSAI / Cromemco disk images',
        notes: 'Disk images ripped from real IMSAI or Cromemco hardware should work directly.',
      },
      {
        label: 'IMD images decoded automatically',
        notes: 'Any .imd file is automatically decoded to flat format on load. Success depends on whether the BIOS on the disk matches the emulated machine.',
      },
      {
        label: 'Gaby\'s CP/M Software Archive',
        url: 'http://www.retroarchive.org/cpm/',
        notes: 'Large archive of CP/M software in IMD and other formats. Many are for specific hardware — look for "IMSAI" or "Cromemco" tagged images.',
      },
      {
        label: 'CP/M User Group (CPMUG) volumes',
        url: 'https://www.retroarchive.org/cpm/sets/CPMUG/',
        notes: 'Generic CP/M software disks. May need a BIOS that matches your machine. Try them — many load under the IMSAI preset.',
      },
    ],
  },
];

const GENERAL_NOTE =
  'A BDOS error or directory of empty colons usually means the disk\'s embedded ' +
  'BIOS uses a different sector order (skew) than this emulator expects. ' +
  'There is no general fix — it requires a matching BIOS.';

// ── Component ─────────────────────────────────────────────────────────────────

export function DiskManager() {
  const diskStatus      = useMachineStore(s => s.diskStatus);
  const diskFormatLabel = useMachineStore(s => s.diskFormatLabel);
  const diskWarnings    = useMachineStore(s => s.diskWarnings);
  const insertDisk      = useMachineStore(s => s.insertDisk);
  const ejectDisk       = useMachineStore(s => s.ejectDisk);
  const wasmReady       = useMachineStore(s => s.wasmReady);
  const slots           = useMachineStore(s => s.slots);

  const [activeWarning, setActiveWarning] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // Find which compat entry matches the current machine's card set
  const cardIds = slots.map(s => s.card);
  const compat  = COMPAT_TABLE.find(c => c.cards.some(id => cardIds.includes(id)));

  const fileRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  const handleFile = (drive: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) insertDisk(drive, file);
    // Reset so the same file can be re-selected
    if (fileRefs[drive].current) fileRefs[drive].current!.value = '';
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ color: '#f0883e', fontSize: 11, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase', flex: 1 }}>
          Disk Drives
        </div>
        <button
          onClick={() => setShowHelp(h => !h)}
          title="Disk compatibility guide"
          style={{
            background: 'transparent',
            border: '1px solid #30363d',
            color: showHelp ? '#58a6ff' : '#8b949e',
            borderRadius: 3,
            padding: '0 5px',
            fontSize: 10,
            cursor: 'pointer',
            fontFamily: 'monospace',
          }}
        >
          ?
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {DRIVE_LABELS.map((label, i) => {
          const hasWarnings = diskWarnings[i] && diskWarnings[i]!.length > 0;
          const isError     = hasWarnings && diskStatus[i]?.endsWith(' ⚠');
          const fmt         = diskFormatLabel[i];

          return (
            <div key={label}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Drive label */}
                <span style={{
                  fontFamily: 'monospace',
                  fontSize: 12,
                  color: diskStatus[i] ? '#3fb950' : '#484f58',
                  minWidth: 16,
                  fontWeight: 'bold',
                }}>
                  {label}:
                </span>

                {/* Filename */}
                <span style={{
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: isError ? '#f85149' : diskStatus[i] ? '#c9d1d9' : '#484f58',
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {diskStatus[i] ?? '—'}
                </span>

                {/* Format badge */}
                {fmt && (
                  <span style={{
                    fontFamily: 'monospace',
                    fontSize: 9,
                    color: isError ? '#f85149' : hasWarnings ? '#e3b341' : '#8b949e',
                    background: '#161b22',
                    border: `1px solid ${isError ? '#f85149' : hasWarnings ? '#e3b341' : '#30363d'}`,
                    borderRadius: 3,
                    padding: '0 4px',
                    flexShrink: 0,
                    cursor: hasWarnings ? 'pointer' : 'default',
                    userSelect: 'none',
                  }}
                    onClick={() => hasWarnings && setActiveWarning(activeWarning === i ? null : i)}
                    title={hasWarnings ? 'Click to show warnings' : fmt}
                  >
                    {fmt}{hasWarnings ? ' ⚠' : ''}
                  </span>
                )}

                {/* Mount/Eject buttons */}
                <input
                  ref={fileRefs[i]}
                  type="file"
                  accept=".dsk,.img,.bin,.imd,.td0"
                  style={{ display: 'none' }}
                  onChange={handleFile(i)}
                />
                {diskStatus[i] ? (
                  <DriveBtn onClick={() => { ejectDisk(i); setActiveWarning(null); }} color="#f85149" disabled={!wasmReady}>
                    ⏏
                  </DriveBtn>
                ) : (
                  <DriveBtn onClick={() => fileRefs[i].current?.click()} disabled={!wasmReady}>
                    ▲
                  </DriveBtn>
                )}
              </div>

              {/* Expandable warnings panel */}
              {activeWarning === i && diskWarnings[i] && (
                <div style={{
                  marginTop: 4,
                  marginLeft: 24,
                  padding: '6px 8px',
                  background: '#0d1117',
                  border: `1px solid ${isError ? '#f85149' : '#e3b341'}`,
                  borderRadius: 4,
                  fontSize: 10,
                  fontFamily: 'monospace',
                  color: isError ? '#f85149' : '#e3b341',
                  lineHeight: 1.5,
                }}>
                  {diskWarnings[i]!.map((w, wi) => (
                    <div key={wi}>{w}</div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Compatibility help panel */}
      {showHelp && (
        <div style={{
          marginTop: 10,
          padding: '8px 10px',
          background: '#0d1117',
          border: '1px solid #30363d',
          borderRadius: 4,
          fontSize: 10,
          fontFamily: 'monospace',
          color: '#8b949e',
          lineHeight: 1.6,
        }}>
          {compat ? (
            <>
              <div style={{ color: '#58a6ff', marginBottom: 4, fontWeight: 'bold' }}>
                {compat.title}
              </div>
              <div style={{ color: '#c9d1d9', marginBottom: 6 }}>
                Format: {compat.format}
              </div>
              <div style={{ color: '#e3b341', marginBottom: 4 }}>Known-good sources:</div>
              {compat.sources.map((src, si) => (
                <div key={si} style={{ marginBottom: 6, paddingLeft: 6, borderLeft: '2px solid #30363d' }}>
                  <div style={{ color: '#c9d1d9' }}>
                    {src.url ? (
                      <a href={src.url} target="_blank" rel="noreferrer"
                        style={{ color: '#58a6ff', textDecoration: 'none' }}>
                        {src.label}
                      </a>
                    ) : src.label}
                  </div>
                  <div>{src.notes}</div>
                </div>
              ))}
            </>
          ) : (
            <div style={{ color: '#c9d1d9' }}>
              Load a machine preset to see compatible disk image sources.
            </div>
          )}
          <div style={{
            marginTop: 8,
            paddingTop: 6,
            borderTop: '1px solid #30363d',
            color: '#484f58',
          }}>
            ⚠ {GENERAL_NOTE}
          </div>
        </div>
      )}
    </div>
  );
}

function DriveBtn({
  onClick, children, color = '#8b949e', disabled = false,
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
        background: 'transparent',
        border: '1px solid #30363d',
        color: disabled ? '#484f58' : color,
        padding: '1px 6px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 11,
        borderRadius: 3,
        fontFamily: 'monospace',
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}
