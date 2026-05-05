import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useMachineStore } from '../store/machineStore';

const FONT = '11px "Courier New", monospace';
const CHAR_W = 7;
const CHAR_H = 13;
const COLS = 80;
const ROWS = 24;

// ANSI color palette (basic 8)
const PALETTE = [
  '#000000', '#cc0000', '#00cc00', '#cccc00',
  '#0000cc', '#cc00cc', '#00cccc', '#cccccc',
];

interface TermLine {
  text: string;
  fg: number; // palette index
}

export function Terminal() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const terminalOutput = useMachineStore(s => s.terminalOutput);
  const sendInput = useMachineStore(s => s.sendInput);
  const clearTerminal = useMachineStore(s => s.clearTerminal);
  const running = useMachineStore(s => s.running);
  const [focused, setFocused] = useState(false);

  // Auto-focus when the machine starts running
  useEffect(() => {
    if (running) canvasRef.current?.focus();
  }, [running]);

  // Simple line-buffer rendering (no full VT100 state machine for MVP)
  const render = useCallback((output: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = FONT;
    ctx.textBaseline = 'top';

    // Process raw output: handle BS, DEL, CR, LF.
    // \r sets a "carriage return pending" flag — the line is overwritten only when
    // the next printable character arrives (teletype CR behaviour).
    // \r\n commits the current line unchanged (standard CRLF).
    const lines: string[] = [];
    let cur = '';
    let crPending = false;
    for (let i = 0; i < output.length; i++) {
      const ch = output[i];
      if (ch === '\r') {
        crPending = true;
      } else if (ch === '\n') {
        lines.push(cur);
        cur = '';
        crPending = false;
      } else if (ch === '\x08' || ch === '\x7f') {
        crPending = false;
        if (cur.length > 0) cur = cur.slice(0, -1);
      } else if (ch >= ' ' || ch === '\t') {
        if (crPending) { cur = ''; crPending = false; }
        cur += ch;
      }
    }
    lines.push(cur); // current (last) line

    const visible = lines.slice(Math.max(0, lines.length - ROWS));

    visible.forEach((line, row) => {
      ctx.fillStyle = '#c9d1d9';
      ctx.fillText(line.slice(0, COLS), 4, row * CHAR_H + 2);
    });

    // Draw cursor at end of last line
    const lastRow = Math.min(visible.length - 1, ROWS - 1);
    const lastLine = visible[visible.length - 1] ?? '';
    const cursorX = 4 + Math.min(lastLine.length, COLS) * CHAR_W;
    const cursorY = lastRow * CHAR_H + 2;
    ctx.fillStyle = '#58a6ff';
    ctx.fillRect(cursorX, cursorY, CHAR_W, CHAR_H - 2);
  }, []);

  useEffect(() => {
    render(terminalOutput);
  }, [terminalOutput, render]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    const key = e.key;
    if (key === 'Enter') {
      sendInput('\r');
    } else if (key === 'Backspace' || key === 'Delete') {
      // CP/M 2.2: 0x08 (^H) echoes BS-SP-BS for a clean visual erase.
      // 0x7F (RUBOUT) echoes the deleted character back, causing visual duplication.
      sendInput('\x08');
    } else if (key === 'ArrowUp') {
      sendInput('\x1b[A');
    } else if (key === 'ArrowDown') {
      sendInput('\x1b[B');
    } else if (key === 'ArrowRight') {
      sendInput('\x1b[C');
    } else if (key === 'ArrowLeft') {
      sendInput('\x1b[D');
    } else if (key.length === 1) {
      sendInput(e.ctrlKey ? String.fromCharCode(key.charCodeAt(0) & 0x1F) : key);
    }
  }, [sendInput]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#8b949e', fontSize: 12 }}>TERMINAL (VT100)</span>
        <button onClick={clearTerminal} style={btnStyle}>Clear</button>
      </div>
      {/* Wrapper positions the "click to focus" overlay */}
      <div
        style={{ position: 'relative', display: 'inline-block', cursor: 'text' }}
        onClick={() => canvasRef.current?.focus()}
      >
        <canvas
          ref={canvasRef}
          width={COLS * CHAR_W + 8}
          height={ROWS * CHAR_H + 4}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            outline: focused ? '1px solid #388bfd' : '1px solid #30363d',
            cursor: 'text',
            background: '#0d1117',
            display: 'block',
            opacity: focused ? 1 : 0.55,
            transition: 'opacity 0.15s, outline-color 0.15s',
          }}
        />
        {!focused && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <span style={{
              color: '#8b949e', fontSize: 11,
              background: 'rgba(13,17,23,0.75)',
              padding: '2px 8px', borderRadius: 3,
              border: '1px solid #30363d',
            }}>
              click to type
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #30363d',
  color: '#8b949e',
  padding: '2px 8px',
  cursor: 'pointer',
  fontSize: 11,
  borderRadius: 3,
};
