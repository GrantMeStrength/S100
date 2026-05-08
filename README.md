# S-100 Virtual Workbench

A browser-based S-100 computer simulator. Assemble virtual Altair/IMSAI-style systems, run CP/M, boot monitor ROMs, and inspect bus activity — all in your browser.

## Features

- **Dual CPU support** — Intel 8080 and Zilog Z80
- **12 system presets** — from bare S-100 bus to full CP/M 2.2 with MBASIC
- **Drag-and-drop chassis** — build machines by placing cards into S-100 slots
- **CP/M 2.2** — boot and run CP/M on Altair 8800 (8080 or Z80) and IMSAI 8080
- **Monitor ROMs** — Memon/80, ALTMON, SSM, AMON v3.1
- **BASIC** — Altair MITS BASIC 8K, IMSAI 8K BASIC v1.4, CP/M MBASIC v5.21
- **Graphics** — Cromemco Dazzler and Processor Technology VDM-1 video cards
- **Floppy controllers** — MITS 88-DCDD, IMSAI FIF, generic FDC, and WD1793
- **Disk manager** — mount, eject, and save disk images per drive
- **Intel HEX loader** — load HEX files directly into memory
- **Bus analyzer** — real-time address/data LED display
- **Trace viewer** — scrollable bus-cycle trace log
- **Memory inspector** — hex viewer/editor for the full 64K address space
- **Programmed output panel** — IMSAI-style output port display

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
core/                # Rust crate → WASM
  src/
    lib.rs           # wasm-bindgen Emulator API
    bus.rs           # S-100 bus (BusInterface trait, card routing)
    card.rs          # S100Card trait (object-safe with downcast support)
    machine.rs       # Machine { cpu, bus } — config loader + card factory
    trace.rs         # TraceBuffer (ring buffer, incremental reads)
    cpu_z80.rs       # Z80 CPU implementation
    cpu/
      i8080.rs       # Intel 8080 (complete instruction set)
    cards/
      ram.rs         # RAM card (configurable base/size)
      rom.rs         # ROM card (hex, base64, or fill; optional phantom port)
      serial.rs      # Generic serial SIO (polled I/O, TX/RX queues)
      sio_88.rs      # MITS 88-2SIO serial card
      fdc.rs         # Generic trap-based CP/M floppy controller
      fdc_fif.rs     # IMSAI FIF descriptor/DMA floppy interface
      fdc_wd1793.rs  # WD1793-style floppy controller
      dcdd.rs        # MITS 88-DCDD hard-sector Altair floppy controller
      dazzler.rs     # Cromemco Dazzler graphics card (ports 0x0E/0x0F)
      vdm.rs         # Processor Technology VDM-1 video display

web/                 # React frontend
  src/
    wasm/index.ts              # Typed WASM wrapper
    store/machineStore.ts      # Zustand store + run loop + presets
    config/cardTypes.ts        # Card type registry for the UI
    components/
      Terminal.tsx             # Canvas-rendered serial terminal
      ChassisView.tsx          # S-100 backplane — drag/drop card placement
      CardLibrary.tsx          # Available-cards palette for chassis building
      CardConfigModal.tsx      # Per-card parameter editing dialog
      ToggleConfigModal.tsx    # Toggle/action configuration dialog
      S100CardShape.tsx        # SVG card shape for the chassis
      BusAnalyzer.tsx          # Address/data LED display
      TraceViewer.tsx          # Scrollable bus-cycle trace
      RegisterView.tsx         # CPU register display
      MemoryView.tsx           # Hex memory viewer/editor
      DiskManager.tsx          # Mount/eject/save disk images
      DazzlerDisplay.tsx       # Cromemco Dazzler frame renderer
      VdmDisplay.tsx           # VDM-1 character display renderer
      ProgrammedOutputPanel.tsx# IMSAI programmed output port display
```

## Build

### Prerequisites

1. **Rust** (stable ≥ 1.85) — install via [rustup](https://rustup.rs/):
   ```sh
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source "$HOME/.cargo/env"
   ```

2. **WASM target** — add the WebAssembly compile target:
   ```sh
   rustup target add wasm32-unknown-unknown
   ```

3. **wasm-pack** — builds the Rust crate into a WASM npm package:
   ```sh
   curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
   ```

4. **Node.js** ≥ 18 — install from [nodejs.org](https://nodejs.org/) or via a version manager like `nvm`.

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

## System Presets

Select a preset from the dropdown to instantly configure a complete system:

| Preset | Description |
|---|---|
| Altair 8800 — 8K Demo | 8K RAM with a built-in demo ROM |
| Altair 8800 — 64K CP/M 2.2 | Full CP/M system with 88-DCDD floppy (8080) |
| Altair Z80 — 64K CP/M 2.2 | Same as above but with a Z80 CPU |
| Altair 8800 — MITS BASIC 8K | Altair BASIC Rev. 4.0 in ROM |
| IMSAI 8080 — CP/M 2.2 (MPU-A ROM) | IMSAI with FIF FDC and MPU-A monitor ROM |
| IMSAI 8080 — CP/M 2.2 + MBASIC | Same as above with MBASIC v5.21 on disk |
| IMSAI 8080 — 8K BASIC v1.4 | IMSAI standalone ROM BASIC |
| Memon/80 v3.06 Monitor (JAIR) | JAIR-style monitor with Z80 SIO |
| ALTMON Monitor (Altair 8800) | ALTMON on 88-2SIO serial |
| SSM 8080 Monitor v1.0 | SSM monitor with AIO serial (inverted polarity) |
| AMON v3.1 Monitor (Altair 8800) | AMON cold-start monitor |
| Bare S-100 Bus | CPU + 64K RAM only — bring your own code |

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
  ],
  "actions": [
    { "type": "toggle", "params": { "entries": [{ "addr": "0000", "bytes": "C3 00 D8" }] } }
  ]
}
```

### Card Types

| Card | Description | Key Params |
|---|---|---|
| `cpu_8080` | Intel 8080 CPU | `speed_hz` (default 2 MHz) |
| `cpu_z80` | Zilog Z80 CPU | `speed_hz` |
| `ram` | Read/write memory | `base`, `size` |
| `rom` | Read-only memory | `base`, `data_hex` or `data_base64` or `size`+`fill`, optional `phantom_port` |
| `serial` | Generic serial SIO (UART) | `data_port`, `status_port`, optional `tx_port`, `rx_port`, `rx_status_port`, `status_rx_bit`, `status_tx_bit`, `status_rx_invert`, `status_tx_invert`, `seven_bit` |
| `sio_88_2sio` | MITS 88-2SIO serial | _(preconfigured)_ |
| `fdc` | Generic trap-based CP/M FDC | _(none)_ |
| `fdc_fif` | IMSAI FIF descriptor/DMA FDC | `tracks`, `sectors`, `sector_size` |
| `fdc_wd1793` | WD1793 floppy controller | `base_port`, `drive_select_port`, `tracks`, `sectors`, `sector_size` |
| `dcdd_88` | MITS 88-DCDD hard-sector FDC | _(none)_ |
| `dazzler` | Cromemco Dazzler graphics | _(ports 0x0E/0x0F)_ |
| `vdm` | VDM-1 video display | `base_addr` |

**Slot order = bus priority.** Cards are checked in slot order; the first card to claim an address wins.

## WASM API

```ts
const em = new Emulator();

// ── Machine lifecycle ────────────────────────────
em.loadMachine(json);           // parse + instantiate machine
em.step(33333);                 // run ~2 MHz for one 60 fps frame
em.reset();                     // reset CPU and all cards
em.getState();                  // → JSON: CPU registers, cards, bus_cycles

// ── Memory ───────────────────────────────────────
em.readMemory(addr);            // peek a byte
em.writeMemory(addr, value);    // poke a byte
em.loadBinary(base, Uint8Array);// bulk load into memory
em.setPC(pc);                   // set the program counter directly

// ── Serial I/O ───────────────────────────────────
em.getSerialOutput();           // drain TX buffer → string
em.sendSerialInput(byte);       // push one byte to RX
em.sendSerialString(str);       // push a string to RX

// ── Bus trace ────────────────────────────────────
em.getTrace(cursor, limit);     // → JSON array of TraceEntry (incremental)
em.traceTotal();                // total entries (use as cursor)

// ── Disk I/O ─────────────────────────────────────
em.insertDisk(drive, Uint8Array); // mount a disk image (0=A … 3=D)
em.getDiskData(drive);            // read back disk image for saving

// ── Video ────────────────────────────────────────
em.getDazzlerFrame();           // → RGBA pixel buffer (with width/height header)
em.getVdmFrame();               // → raw 1024-byte VDM-1 VRAM
```

## Milestones

- [x] **Phase 1**: Bus model + 8080 CPU + RAM/ROM/Serial cards + WASM API
- [x] **Phase 2**: Floppy controllers (88-DCDD, FIF, WD1793, generic FDC) + CP/M 2.2 boot
- [x] **Phase 3**: Chassis UI with drag-and-drop card placement + card library
- [x] **Phase 4**: Z80 CPU, Dazzler & VDM-1 graphics, memory inspector, disk manager
- [ ] **Phase 5**: Debugger + step/breakpoint tools
- [ ] **Phase 6**: JS custom card API + WASM plugin system
