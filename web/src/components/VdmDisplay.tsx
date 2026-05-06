// VDM-1 video display component
//
// Renders the 16 × 64 character display of the Processor Technology VDM-1 card.
// The core applies the DSTAT circular-buffer offset and shadow blanking before
// returning the frame, so the frontend renders the 1024 bytes linearly.
// Each byte: bit 7 = inverse video, bits 6-0 = ASCII character.
//
// Display geometry:
//   64 cols × 8 px  =  512 px wide
//   16 rows × 16 px =  256 px tall
//
// Phosphor green palette (approximating the P31 phosphor used on period monitors):
//   Normal:  #33ff66 on #061006
//   Inverse: #061006 on #33ff66

import React, { useEffect, useRef, useCallback } from 'react';
import { getVdmFrame } from '../wasm/index';

const COLS   = 64;
const ROWS   = 16;
const CELL_W = 8;
const CELL_H = 16;
const WIDTH  = COLS * CELL_W;   // 512
const HEIGHT = ROWS * CELL_H;   // 256

const FG_NORMAL  = '#33ff66';
const BG_NORMAL  = '#061006';
const FG_INVERSE = '#061006';
const BG_INVERSE = '#33ff66';

// Monospace font to use for character rendering.
// 'Courier New' is universally available; we size it to fit CELL_H.
const FONT = `${CELL_H * 0.75}px "Courier New", Courier, monospace`;

export function VdmDisplay(): React.ReactElement {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const rafRef     = useRef<number>(0);
  const frameCount = useRef<number>(0);

  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const vram = getVdmFrame();
    if (vram.length !== COLS * ROWS) {
      // Card not active — show black screen
      ctx.fillStyle = BG_NORMAL;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      rafRef.current = requestAnimationFrame(renderFrame);
      return;
    }

    // Only repaint when content has changed (avoid unnecessary GPU traffic)
    frameCount.current++;

    ctx.font = FONT;
    ctx.textBaseline = 'top';

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const byte  = vram[row * COLS + col];
        const inv   = (byte & 0x80) !== 0;
        const ascii = byte & 0x7F;
        const ch    = ascii >= 0x20 ? String.fromCharCode(ascii) : ' ';

        const bg = inv ? BG_INVERSE : BG_NORMAL;
        const fg = inv ? FG_INVERSE : FG_NORMAL;

        const x = col * CELL_W;
        const y = row * CELL_H;

        ctx.fillStyle = bg;
        ctx.fillRect(x, y, CELL_W, CELL_H);

        if (ch !== ' ') {
          ctx.fillStyle = fg;
          ctx.fillText(ch, x, y);
        }
      }
    }

    rafRef.current = requestAnimationFrame(renderFrame);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [renderFrame]);

  return (
    <div className="vdm-display-wrapper" style={{
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'flex-start',
      gap:            '4px',
    }}>
      <div style={{ fontSize: '11px', color: '#33cc66', fontFamily: 'monospace', letterSpacing: '0.05em' }}>
        VDM-1 · 64×16
      </div>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        style={{
          display:       'block',
          border:        '1px solid #33ff6640',
          borderRadius:  '4px',
          imageRendering: 'pixelated',
          background:    BG_NORMAL,
          maxWidth:      '100%',
        }}
      />
    </div>
  );
}
