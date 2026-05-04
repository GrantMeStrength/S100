# S-100 Virtual Workbench

A browser-based S-100 computer simulator. Assemble virtual Altair/IMSAI-style systems, run CP/M, and inspect bus activity in real time.

## Tech Stack

| Layer | Tech |
|---|---|
| Core emulator | Rust → WebAssembly |
| Frontend | TypeScript + React |
| Rendering | HTML Canvas |
| State | Zustand |
| Build | Vite + wasm-pack |

## Architecture

```
core/          # Rust crate → WASM
  src/
    lib.rs     # wasm-bindgen Emulator API
    bus.rs     # S-100 bus (BusInterface trait, card routing)
    card.rs    # S100Card trait (object-safe with downcast support)
    machine.rs # Machine { cpu: Cpu8080, bus: Bus }
    trace.rs   # TraceBuffer (ring buffer, incremental reads)
    cards/
      ram.rs   # RAM card (configurable base/size)
      rom.rs   # ROM card (base64 or hex data from machine config)
      serial.rs# UART card (polled I/O, TX/RX queues)
    cpu/
      i8080.rs # Intel 8080 (complete instruction set)

web/           # React frontend
  src/
    wasm/index.ts         # Typed WASM wrapper
    store/machineStore.ts # Zustand store + run loop
    components/
      Terminal.tsx        # Canvas-rendered serial terminal
      ChassisView.tsx     # S-100 backplane visualization
      BusAnalyzer.tsx     # Address/data LED display
      TraceViewer.tsx     # Scrollable bus trace
      RegisterView.tsx    # CPU register display
```

## Build

### Prerequisites

- Rust (stable ≥ 1.85)
- `wasm-pack`  — `cargo install wasm-pack`
- Node.js ≥ 18

### WASM core

```sh
cd core
wasm-pack build --target web --out-dir ../web/src/wasm/pkg
```

### Web frontend

```sh
cd web
npm install
npm run dev       # dev server at http://localhost:5173
npm run build     # production build → dist/
```

### Combined (convenience)

```sh
cd web && npm run build:wasm && npm run dev
```

## Machine Definition Format

Machines are defined in JSON — no hardcoded configs.

```json
{
  "name": "IMSAI CP/M System",
  "slots": [
    { "slot": 0, "card": "cpu_8080" },
    { "slot": 1, "card": "rom",    "params": { "base": 0, "data_hex": "3E48D300..." } },
    { "slot": 2, "card": "ram",    "params": { "base": 32768, "size": 32768 } },
    { "slot": 3, "card": "serial", "params": { "data_port": 0, "status_port": 1 } }
  ]
}
```

### Card types

| Card | Params |
|---|---|
| `cpu_8080` | _(none)_ |
| `ram` | `base` (u16), `size` (usize) |
| `rom` | `base` (u16), `data_hex` or `data_base64` or `size`+`fill` |
| `serial` | `data_port` (u8), `status_port` (u8) |

**Slot order = bus priority.** Cards are checked in slot order; the first card to claim an address wins.

## WASM API

```ts
const em = new Emulator();
em.loadMachine(json);  // parse + instantiate machine
em.step(33333);        // run ~2 MHz for one 60fps frame
em.reset();
em.getState();         // → JSON with CPU registers, cards, bus_cycles
em.getTrace(cursor, limit); // → JSON array of TraceEntry (incremental)
em.traceTotal();       // cursor position
em.readMemory(addr);
em.writeMemory(addr, value);
em.loadBinary(base, Uint8Array); // bulk load
em.getSerialOutput();  // drain TX buffer → string
em.sendSerialInput(byte);
em.sendSerialString(str);
```

## Milestones

- [x] **Phase 1**: Bus model + 8080 CPU + RAM/ROM/Serial cards + WASM API
- [ ] **Phase 2**: Floppy controller + CP/M 2.2 boot
- [ ] **Phase 3**: Full chassis UI + drag/drop cards
- [ ] **Phase 4**: Debugger + step/breakpoint tools
- [ ] **Phase 5**: JS custom card API + WASM plugin system
