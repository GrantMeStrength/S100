import React, { useCallback, useRef, useEffect, useState } from 'react';
import * as wasm from '../wasm/index';

// Bit layout matching the Cromemco D+7A card (host convention: 1 = pressed)
const BIT_UP    = 0x01;
const BIT_DOWN  = 0x02;
const BIT_LEFT  = 0x04;
const BIT_RIGHT = 0x08;
const BIT_BTN1  = 0x10;
const BIT_BTN2  = 0x20;
const BIT_BTN4  = 0x40;

const DPAD_SIZE = 120;
const BTN_SIZE = 44;

// Keyboard mapping for joystick 1 (desktop use)
const KEY_MAP_JS1: Record<string, number> = {
  ArrowUp: BIT_UP, w: BIT_UP, W: BIT_UP,
  ArrowDown: BIT_DOWN, s: BIT_DOWN, S: BIT_DOWN,
  ArrowLeft: BIT_LEFT, a: BIT_LEFT, A: BIT_LEFT,
  ArrowRight: BIT_RIGHT, d: BIT_RIGHT, D: BIT_RIGHT,
  ' ': BIT_BTN1,
  z: BIT_BTN2, Z: BIT_BTN2,
  x: BIT_BTN4, X: BIT_BTN4,
};

// Keyboard mapping for joystick 2
const KEY_MAP_JS2: Record<string, number> = {
  i: BIT_UP, I: BIT_UP,
  k: BIT_DOWN, K: BIT_DOWN,
  j: BIT_LEFT, J: BIT_LEFT,
  l: BIT_RIGHT, L: BIT_RIGHT,
  n: BIT_BTN1, N: BIT_BTN1,
  m: BIT_BTN2, M: BIT_BTN2,
  ',': BIT_BTN4,
};

// Compute port values matching Rust card logic (for debug display)
function buttonsNibble(ui: number): number {
  const b1 = (ui >> 4) & 1;
  const b2 = (ui >> 5) & 1;
  const b4 = (ui >> 6) & 1;
  return (~b1 & 1) | ((~b2 & 1) << 1) | ((~b4 & 1) << 2) | 0x08;
}
function axisOffset(ui: number, negBit: number, posBit: number): number {
  const neg = (ui >> negBit) & 1;
  const pos = (ui >> posBit) & 1;
  if (neg && !pos) return 0x81;  // -127 signed
  if (!neg && pos) return 0x7F;  // +127 signed
  return 0x00;                    // center
}
function computePorts(js1: number, js2: number) {
  const lo = buttonsNibble(js1);
  const hi = buttonsNibble(js2) << 4;
  return {
    0x18: (lo | hi) & 0xFF,
    0x19: axisOffset(js1, 2, 3),  // X: Left=neg, Right=pos
    0x1A: axisOffset(js1, 0, 1),  // Y: Up=neg, Down=pos
    0x1B: axisOffset(js2, 2, 3),
    0x1C: axisOffset(js2, 0, 1),
  };
}

export function VirtualJoystick() {
  const [js1State, setJs1State] = useState(0);
  const [js2State, setJs2State] = useState(0);
  const ports = computePorts(js1State, js2State);

  return (
    <div style={{ userSelect: 'none' }}>
      <div style={{ display: 'flex', gap: 24 }}>
        <JoystickUnit
          label="JS-1 (Player 1)"
          keyMap={KEY_MAP_JS1}
          keyHint="Arrows/WASD · Btn: Space/Z/X"
          onState={(v) => {
            setJs1State(v);
            try { wasm.setJoystickState(v); } catch { /* wasm not ready */ }
          }}
        />
        <JoystickUnit
          label="JS-2 (Player 2)"
          keyMap={KEY_MAP_JS2}
          keyHint="IJKL · Btn: N/M/,"
          onState={(v) => {
            setJs2State(v);
            try { wasm.setJoystickState2(v); } catch { /* wasm not ready */ }
          }}
        />
      </div>
      {/* Debug: show computed port values */}
      <div style={{
        marginTop: 8,
        padding: '6px 10px',
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: 4,
        fontFamily: 'monospace',
        fontSize: 11,
        color: '#8b949e',
        display: 'flex',
        gap: 16,
        flexWrap: 'wrap',
      }}>
        <span style={{ color: '#58a6ff' }}>D+7A Ports:</span>
        {Object.entries(ports).map(([port, val]) => {
          const numVal = val as number;
          const isIdle = (Number(port) === 0x18 && numVal === 0xFF)
            || (Number(port) !== 0x18 && numVal === 0x00);
          return (
            <span key={port} style={{ color: isIdle ? '#6e7681' : '#f0f0f0' }}>
              {`0x${Number(port).toString(16).toUpperCase()}: 0x${numVal.toString(16).toUpperCase().padStart(2, '0')}`}
              {` (${numVal})`}
            </span>
          );
        })}
        <span style={{ color: '#6e7681' }}>
          UI: 0x{js1State.toString(16).toUpperCase().padStart(2, '0')}
        </span>
      </div>
    </div>
  );
}

function JoystickUnit({ label, keyMap, keyHint, onState }: {
  label: string;
  keyMap: Record<string, number>;
  keyHint: string;
  onState: (value: number) => void;
}) {
  const [displayState, setDisplayState] = useState(0);
  const keyBitsRef = useRef(0);
  const dpadBitsRef = useRef(0);
  const btnBitsRef = useRef(0);

  const sync = useCallback(() => {
    const combined = keyBitsRef.current | dpadBitsRef.current | btnBitsRef.current;
    setDisplayState(combined);
    onState(combined);
  }, [onState]);

  // Keyboard handler
  useEffect(() => {
    const onKey = (e: KeyboardEvent, pressed: boolean) => {
      const bit = keyMap[e.key];
      if (bit === undefined) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      if (pressed) {
        keyBitsRef.current |= bit;
      } else {
        keyBitsRef.current &= ~bit;
      }
      sync();
    };
    const down = (e: KeyboardEvent) => onKey(e, true);
    const up   = (e: KeyboardEvent) => onKey(e, false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      keyBitsRef.current = 0;
      sync();
    };
  }, [keyMap, sync]);

  // D-pad touch/mouse handler
  const dpadRef = useRef<HTMLDivElement>(null);

  const dpadFromPointer = useCallback((clientX: number, clientY: number) => {
    const el = dpadRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const deadzone = r.width * 0.15;

    let bits = 0;
    if (dy < -deadzone) bits |= BIT_UP;
    if (dy > deadzone)  bits |= BIT_DOWN;
    if (dx < -deadzone) bits |= BIT_LEFT;
    if (dx > deadzone)  bits |= BIT_RIGHT;
    dpadBitsRef.current = bits;
    sync();
  }, [sync]);

  const dpadClear = useCallback(() => {
    dpadBitsRef.current = 0;
    sync();
  }, [sync]);

  const onDpadMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dpadFromPointer(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => dpadFromPointer(ev.clientX, ev.clientY);
    const onUp = () => {
      dpadClear();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [dpadFromPointer, dpadClear]);

  const onDpadTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    dpadFromPointer(touch.clientX, touch.clientY);
  }, [dpadFromPointer]);

  const onDpadTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    dpadFromPointer(touch.clientX, touch.clientY);
  }, [dpadFromPointer]);

  const onDpadTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    dpadClear();
  }, [dpadClear]);

  // Button handlers
  const btnDown = useCallback((bit: number) => {
    btnBitsRef.current |= bit;
    sync();
  }, [sync]);
  const btnUp = useCallback((bit: number) => {
    btnBitsRef.current &= ~bit;
    sync();
  }, [sync]);

  const isUp    = !!(displayState & BIT_UP);
  const isDown  = !!(displayState & BIT_DOWN);
  const isLeft  = !!(displayState & BIT_LEFT);
  const isRight = !!(displayState & BIT_RIGHT);
  const isBtn1  = !!(displayState & BIT_BTN1);
  const isBtn2  = !!(displayState & BIT_BTN2);
  const isBtn4  = !!(displayState & BIT_BTN4);

  return (
    <div>
      <div style={{
        fontSize: 11,
        color: '#8b949e',
        fontFamily: 'monospace',
        letterSpacing: 1,
        textTransform: 'uppercase',
        marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {/* D-pad */}
        <div
          ref={dpadRef}
          onMouseDown={onDpadMouseDown}
          onTouchStart={onDpadTouchStart}
          onTouchMove={onDpadTouchMove}
          onTouchEnd={onDpadTouchEnd}
          style={{
            width: DPAD_SIZE,
            height: DPAD_SIZE,
            position: 'relative',
            cursor: 'pointer',
            touchAction: 'none',
          }}
        >
          <DpadBtn x={(DPAD_SIZE - BTN_SIZE) / 2} y={0} active={isUp} label="▲" />
          <DpadBtn x={(DPAD_SIZE - BTN_SIZE) / 2} y={DPAD_SIZE - BTN_SIZE} active={isDown} label="▼" />
          <DpadBtn x={0} y={(DPAD_SIZE - BTN_SIZE) / 2} active={isLeft} label="◀" />
          <DpadBtn x={DPAD_SIZE - BTN_SIZE} y={(DPAD_SIZE - BTN_SIZE) / 2} active={isRight} label="▶" />
          <div style={{
            position: 'absolute',
            left: (DPAD_SIZE - BTN_SIZE) / 2,
            top: (DPAD_SIZE - BTN_SIZE) / 2,
            width: BTN_SIZE,
            height: BTN_SIZE,
            background: '#21262d',
            border: '1px solid #30363d',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#30363d' }} />
          </div>
        </div>

        {/* Buttons 1, 2, 4 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
          <FireBtn label="1" active={isBtn1} bit={BIT_BTN1} onDown={btnDown} onUp={btnUp} />
          <FireBtn label="2" active={isBtn2} bit={BIT_BTN2} onDown={btnDown} onUp={btnUp} />
          <FireBtn label="4" active={isBtn4} bit={BIT_BTN4} onDown={btnDown} onUp={btnUp} />
        </div>
      </div>
      <div style={{ fontSize: 10, color: '#6e7681', marginTop: 4, fontFamily: 'monospace' }}>
        {keyHint}
      </div>
    </div>
  );
}

function FireBtn({ label, active, bit, onDown, onUp }: {
  label: string; active: boolean; bit: number;
  onDown: (bit: number) => void; onUp: (bit: number) => void;
}) {
  return (
    <div
      onMouseDown={e => { e.preventDefault(); onDown(bit); }}
      onMouseUp={() => onUp(bit)}
      onMouseLeave={() => onUp(bit)}
      onTouchStart={e => { e.preventDefault(); onDown(bit); }}
      onTouchEnd={e => { e.preventDefault(); onUp(bit); }}
      style={{
        width: 48,
        height: 48,
        borderRadius: '50%',
        background: active ? '#f85149' : '#5a1d1d',
        border: `2px solid ${active ? '#f85149' : '#8b3a3a'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        touchAction: 'none',
        transition: 'background 0.05s',
      }}
    >
      <span style={{
        color: '#f0f0f0',
        fontSize: 10,
        fontFamily: 'monospace',
        fontWeight: 'bold',
        pointerEvents: 'none',
      }}>
        {label}
      </span>
    </div>
  );
}

function DpadBtn({ x, y, active, label }: { x: number; y: number; active: boolean; label: string }) {
  return (
    <div style={{
      position: 'absolute',
      left: x,
      top: y,
      width: BTN_SIZE,
      height: BTN_SIZE,
      background: active ? '#1f6feb' : '#21262d',
      border: `1px solid ${active ? '#1f6feb' : '#30363d'}`,
      borderRadius: 4,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none',
      transition: 'background 0.05s',
    }}>
      <span style={{
        color: active ? '#fff' : '#6e7681',
        fontSize: 14,
      }}>
        {label}
      </span>
    </div>
  );
}
