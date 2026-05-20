/**
 * DiskFileBrowser — CP/M file browser for mounted disk images.
 * Shows file listing, allows download/upload/delete of individual files.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useMachineStore } from '../store/machineStore';
import { listFiles, extractFile, writeFile, deleteFile, getDiskStats, CpmFile } from '../utils/cpmFiles';
import * as wasm from '../wasm';

type DiskModState = 'idle' | 'modified';

interface Props {
  drive: number;
  onClose: () => void;
}

export function DiskFileBrowser({ drive, onClose }: Props) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [modState, setModState] = useState<DiskModState>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const warmReset = useMachineStore(s => s.warmReset);

  // Get current disk data
  const diskData = useMemo(() => {
    try {
      return wasm.getDiskData(drive);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drive, refreshKey]);

  const files = useMemo(() => {
    if (!diskData || diskData.length === 0) return [];
    return listFiles(diskData);
  }, [diskData]);

  const stats = useMemo(() => {
    if (!diskData || diskData.length === 0) return null;
    return getDiskStats(diskData);
  }, [diskData]);

  const refresh = useCallback(() => {
    setRefreshKey(k => k + 1);
    setError(null);
  }, []);

  const handleReboot = useCallback(() => {
    // Enable disk sector tracing to diagnose DIR issues
    try { wasm.enableDiskTrace(); } catch { /* trace not available */ }
    warmReset();
    // After 3 seconds, dump the trace to console and disable
    setTimeout(() => {
      try {
        // Read memory at address 0 to find warm boot vector
        const jmpAddr = wasm.readMemory(1) | (wasm.readMemory(2) << 8);
        console.log('[BIOS] Address 0 → JMP', jmpAddr.toString(16).padStart(4, '0'));
        
        // Read BIOS jump table (17 entries × 3 bytes)
        const biosBase = jmpAddr - 3; // WBOOT is at BIOS+3
        console.log('[BIOS] Jump table at', biosBase.toString(16).padStart(4, '0'));
        const names = ['BOOT','WBOOT','CONST','CONIN','CONOUT','LIST','PUNCH','READER',
          'HOME','SELDSK','SETTRK','SETSEC','SETDMA','READ','WRITE','LISTST','SECTRAN'];
        for (let j = 0; j < 17; j++) {
          const addr = biosBase + j * 3;
          const target = wasm.readMemory(addr + 1) | (wasm.readMemory(addr + 2) << 8);
          console.log('  ' + names[j].padEnd(8) + 'JMP', target.toString(16).padStart(4, '0'));
        }
        
        // Read SECTRAN implementation
        const sectranAddr = wasm.readMemory(biosBase + 16*3 + 1) | (wasm.readMemory(biosBase + 16*3 + 2) << 8);
        console.log('[BIOS] SECTRAN code at', sectranAddr.toString(16).padStart(4, '0'), ':');
        const sectranBytes: string[] = [];
        for (let i = 0; i < 16; i++) {
          sectranBytes.push(wasm.readMemory(sectranAddr + i).toString(16).padStart(2, '0'));
        }
        console.log('  ', sectranBytes.join(' '));
        
        // Read SELDSK implementation to find DPH
        const seldskAddr = wasm.readMemory(biosBase + 9*3 + 1) | (wasm.readMemory(biosBase + 9*3 + 2) << 8);
        console.log('[BIOS] SELDSK code at', seldskAddr.toString(16).padStart(4, '0'), ':');
        const seldskBytes: string[] = [];
        for (let i = 0; i < 32; i++) {
          seldskBytes.push(wasm.readMemory(seldskAddr + i).toString(16).padStart(2, '0'));
        }
        console.log('  ', seldskBytes.join(' '));
        
        // Find LXI H in SELDSK to get DPH table address
        for (let i = 0; i < 32; i++) {
          if (wasm.readMemory(seldskAddr + i) === 0x21) { // LXI H
            const dphAddr = wasm.readMemory(seldskAddr + i + 1) | (wasm.readMemory(seldskAddr + i + 2) << 8);
            if (dphAddr > 0xD000 && dphAddr < 0xF000) {
              console.log('[BIOS] DPH table at', dphAddr.toString(16).padStart(4, '0'));
              // Read first DPH (16 bytes)
              const xlt = wasm.readMemory(dphAddr) | (wasm.readMemory(dphAddr + 1) << 8);
              const dpb = wasm.readMemory(dphAddr + 10) | (wasm.readMemory(dphAddr + 11) << 8);
              console.log('  XLT=' + xlt.toString(16).padStart(4, '0'), 'DPB=' + dpb.toString(16).padStart(4, '0'));
              
              if (xlt !== 0 && xlt > 0xD000 && xlt < 0xF000) {
                // Dump skew table
                const skew: number[] = [];
                for (let s = 0; s < 32; s++) skew.push(wasm.readMemory(xlt + s));
                console.log('  SECTRAN table:', skew.join(','));
              } else {
                console.log('  XLT=0 → NO sector translation (identity mapping)');
              }
              
              if (dpb > 0xD000 && dpb < 0xF000) {
                const spt = wasm.readMemory(dpb) | (wasm.readMemory(dpb + 1) << 8);
                const bsh = wasm.readMemory(dpb + 2);
                const off = wasm.readMemory(dpb + 13) | (wasm.readMemory(dpb + 14) << 8);
                console.log('  DPB: SPT=' + spt + ' BSH=' + bsh + ' (BLS=' + (128 << bsh) + ') OFF=' + off);
              }
              break;
            }
          }
        }

        const trace = wasm.getDiskTrace();
        if (trace.length > 0) {
          console.log('[DCDD Trace] Sector reads after reboot (' + (trace.length / 2) + ' reads):');
          const byTrack = new Map<number, number[]>();
          for (let i = 0; i < trace.length; i += 2) {
            const t = trace[i], s = trace[i + 1];
            if (!byTrack.has(t)) byTrack.set(t, []);
            byTrack.get(t)!.push(s);
          }
          for (const [t, sectors] of byTrack) {
            console.log(`  Track ${t}: sectors [${sectors.join(', ')}]`);
          }
        }
        wasm.disableDiskTrace();
      } catch (e) { console.error('[Trace error]', e); }
    }, 3000);
    setModState('idle');
    onClose();
  }, [warmReset, onClose]);

  const handleDownload = useCallback((file: CpmFile) => {
    if (!diskData) return;
    const content = extractFile(diskData, file);
    if (!content) {
      setError(`Failed to extract ${file.name}`);
      return;
    }
    const blob = new Blob([new Uint8Array(content)], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  }, [diskData]);

  const handleDelete = useCallback((file: CpmFile) => {
    // Read FRESH disk data (CP/M may have written since modal opened)
    let fresh: Uint8Array;
    try { fresh = wasm.getDiskData(drive); } catch { return; }
    if (!fresh || fresh.length === 0) return;
    const newData = deleteFile(fresh, file);
    wasm.insertDisk(drive, newData);
    setModState('modified');
    refresh();
  }, [drive, refresh]);

  const uploadFile = useCallback(async (file: File) => {
    setError(null);
    // Read FRESH disk data (CP/M may have written since modal opened)
    let fresh: Uint8Array;
    try { fresh = wasm.getDiskData(drive); } catch { setError('Cannot read disk'); return; }
    if (!fresh || fresh.length === 0) { setError('No disk mounted'); return; }
    const buffer = await file.arrayBuffer();
    const fileBytes = new Uint8Array(buffer);
    const result = writeFile(fresh, file.name, fileBytes);
    if (result.error) { setError(result.error); return; }
    wasm.insertDisk(drive, result.data);
    setModState('modified');
    refresh();
  }, [drive, refresh]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      uploadFile(files[i]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [uploadFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      uploadFile(files[i]);
    }
  }, [uploadFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  if (!diskData || diskData.length === 0) {
    return (
      <div style={modalOverlay}>
        <div style={modalBox}>
          <div style={headerRow}>
            <span style={{ color: '#f0883e', fontSize: 12, fontWeight: 600 }}>
              Drive {'ABCD'[drive]}: — No Disk
            </span>
            <button onClick={onClose} style={closeBtn}>✕</button>
          </div>
          <div style={{ color: '#8b949e', fontSize: 11, padding: 12 }}>
            No disk mounted in this drive.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={modalOverlay}>
      <div style={{ ...modalBox, maxHeight: '80vh' }}>
        {/* Header */}
        <div style={headerRow}>
          <div>
            <span style={{ color: '#f0883e', fontSize: 12, fontWeight: 600 }}>
              Drive {'ABCD'[drive]}: — CP/M Files
            </span>
            {stats && (
              <span style={{ color: '#6e7681', fontSize: 10, marginLeft: 8, fontFamily: 'monospace' }}>
                {stats.fileCount} files · {stats.usedKb}K used · {stats.freeKb}K free
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={refresh} style={actionBtn} title="Refresh file list">↻</button>
            <button onClick={onClose} style={closeBtn}>✕</button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{ padding: '6px 10px', background: '#1a0505', border: '1px solid #4a1515', borderRadius: 3, color: '#f85149', fontSize: 10, margin: '0 12px' }}>
            {error}
          </div>
        )}

        {/* Disk modified — reboot prompt */}
        {modState === 'modified' && !error && (
          <div style={{ padding: '6px 10px', background: '#0d1a0d', border: '1px solid #2ea043', borderRadius: 3, color: '#3fb950', fontSize: 10, margin: '0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>✓ Disk updated</span>
            <button
              onClick={handleReboot}
              style={{
                background: '#238636', border: '1px solid #2ea043', borderRadius: 3,
                color: '#e6edf3', cursor: 'pointer', fontSize: 10, padding: '2px 8px',
                fontFamily: 'monospace',
              }}
            >
              Reboot CP/M
            </button>
            <span style={{ color: '#6e7681' }}>to refresh DIR (use at CP/M prompt)</span>
          </div>
        )}

        {/* File list */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '4px 12px',
            border: dragOver ? '2px dashed #3fb950' : '2px dashed transparent',
            borderRadius: 4,
            transition: 'border-color 0.15s',
          }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {files.length === 0 ? (
            <div style={{ color: '#484f58', fontSize: 11, fontStyle: 'italic', padding: '20px 0', textAlign: 'center' }}>
              No files on disk — drag & drop files here to upload
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'monospace' }}>
              <thead>
                <tr style={{ color: '#6e7681', borderBottom: '1px solid #21262d' }}>
                  <th style={thStyle}>Name</th>
                  <th style={{ ...thStyle, textAlign: 'right', width: 60 }}>Size</th>
                  <th style={{ ...thStyle, textAlign: 'center', width: 40 }}>Usr</th>
                  <th style={{ ...thStyle, textAlign: 'center', width: 40 }}>Attr</th>
                  <th style={{ ...thStyle, textAlign: 'right', width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {files.map((file, idx) => (
                  <tr
                    key={`${file.name}-${file.user}-${idx}`}
                    style={{ borderBottom: '1px solid #161b22' }}
                  >
                    <td style={{ ...tdStyle, color: '#e6edf3' }}>
                      {file.name}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: '#8b949e' }}>
                      {formatSize(file.size)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center', color: '#6e7681' }}>
                      {file.user}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center', color: '#6e7681' }}>
                      {file.readOnly ? 'R/O' : ''}{file.system ? ' SYS' : ''}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <button
                        onClick={() => handleDownload(file)}
                        title="Download file"
                        style={tblBtn}
                      >↓</button>
                      <button
                        onClick={() => handleDelete(file)}
                        title="Delete file"
                        style={{ ...tblBtn, color: '#f85149' }}
                      >✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Upload area */}
        <div style={{ padding: '8px 12px', borderTop: '1px solid #21262d', display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileInput}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              background: '#238636',
              border: '1px solid #2ea043',
              borderRadius: 4,
              color: '#e6edf3',
              cursor: 'pointer',
              fontSize: 11,
              padding: '4px 12px',
              fontFamily: 'monospace',
            }}
          >
            Upload File
          </button>
          <span style={{ color: '#484f58', fontSize: 10, fontStyle: 'italic' }}>
            or drag & drop files onto the list above
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  return `${Math.ceil(bytes / 1024)}K`;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const modalOverlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};

const modalBox: React.CSSProperties = {
  width: 500,
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 8,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const headerRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '10px 12px', borderBottom: '1px solid #21262d',
};

const closeBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#8b949e',
  cursor: 'pointer', fontSize: 16, lineHeight: 1,
};

const actionBtn: React.CSSProperties = {
  background: '#21262d', border: '1px solid #30363d', borderRadius: 3,
  color: '#8b949e', cursor: 'pointer', fontSize: 12, padding: '2px 8px',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '4px 6px', fontSize: 10,
  fontWeight: 'normal', letterSpacing: 0.5,
};

const tdStyle: React.CSSProperties = {
  padding: '4px 6px',
};

const tblBtn: React.CSSProperties = {
  background: 'none', border: '1px solid #30363d', borderRadius: 3,
  color: '#79c0ff', cursor: 'pointer', fontSize: 11, padding: '1px 5px',
  marginLeft: 4, fontFamily: 'monospace',
};
