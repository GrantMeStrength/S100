import React, { useEffect, useRef } from 'react';
import { useMachineStore } from '../store/machineStore';
import * as wasm from '../wasm/index';

const DISPLAY_SIZE = 256; // canvas CSS pixels (always square)

export function DazzlerDisplay() {
  const running = useMachineStore(s => s.running);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let active = true;

    const render = () => {
      if (!active) return;
      rafRef.current = requestAnimationFrame(render);

      const raw = wasm.getDazzlerFrame?.();
      if (!raw || raw.length < 4) {
        // Display disabled — show dark screen
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
      }

      const w = raw[0] | (raw[1] << 8);
      const h = raw[2] | (raw[3] << 8);
      const pixels = raw.subarray(4);

      if (w === 0 || h === 0 || pixels.length !== w * h * 4) return;

      const imgData = ctx.createImageData(w, h);
      imgData.data.set(pixels);

      // Scale to canvas (nearest-neighbor via offscreen canvas)
      const offscreen = new OffscreenCanvas(w, h);
      const offCtx = offscreen.getContext('2d')!;
      offCtx.putImageData(imgData, 0, 0);

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => {
      active = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [running]);

  return (
    <div>
      <div style={{
        fontSize: 10,
        color: '#8b949e',
        fontFamily: 'monospace',
        letterSpacing: 1,
        textTransform: 'uppercase',
        marginBottom: 4,
      }}>
        Cromemco Dazzler
      </div>
      <canvas
        ref={canvasRef}
        width={DISPLAY_SIZE}
        height={DISPLAY_SIZE}
        style={{
          display: 'block',
          width: DISPLAY_SIZE,
          height: DISPLAY_SIZE,
          border: '1px solid #30363d',
          background: '#0a0a0a',
          imageRendering: 'pixelated',
        }}
      />
      <div style={{ fontSize: 9, color: '#484f58', marginTop: 2, fontFamily: 'monospace' }}>
        Port 0x0E: NX (addr+enable) · 0x0F: CC (color/X4)
      </div>
    </div>
  );
}
