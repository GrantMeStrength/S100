// IMSAI FIF (Floppy Interface) FDC emulation
//
// Used by the IMSAI MPU-A / MPU-B monitor ROMs (TheHighNibble / bhall66 variants).
// Unlike a real WD1793, this FDC exposes a single port (0xFD) and a "disk descriptor"
// structure in system RAM.  The CPU writes the descriptor then issues a 4-byte command
// sequence to trigger a DMA transfer.
//
// Port 0xFD — 4-byte command sequence:
//   OUT 0xFD, 0x10   → "set descriptor address"
//   OUT 0xFD, lo     → descriptor address LSB
//   OUT 0xFD, hi     → descriptor address MSB
//   OUT 0xFD, 0x00   → "execute"  (sets pending_execute)
//
// Disk descriptor (7 bytes at desc_addr in system RAM):
//   Byte 0 (FDCMD): (operation << 4) | drive_one_hot
//                   operation 2 = read, 1 = write
//                   drive bits: 0x01=A, 0x02=B, 0x04=C, 0x08=D
//   Byte 1 (FDRES): result written back by FDC; non-zero when done (1=OK, 2=error)
//   Byte 2:         unused
//   Byte 3 (FDTRK): track number (0-indexed)
//   Byte 4 (FDSEC): sector number (1-indexed)
//   Bytes 5-6 (FDDMA): DMA target address in RAM, little-endian
//
// The ROM also writes to ports 0xF3 (bank-switching) and 0xFE (write-protect); both
// are no-ops in this emulator.
//
// DMA execution is handled by Machine::step() after each cpu.step(), not here, because
// the FDC needs access to system RAM (owned by the Bus) to copy sector data.
//
// Disk image format: flat binary, 0-indexed tracks, 1-indexed sectors.
//   Offset = (track × sectors_per_track + sector − 1) × sector_size

use std::any::Any;
use crate::card::S100Card;

const FIF_PORT:  u8 = 0xFD;
const MBC_PORT:  u8 = 0xF3;   // bank-switching — no-op
const WP_PORT:   u8 = 0xFE;   // write-protect  — no-op

enum FifState {
    Idle,
    GotSetDesc,
    GotAddrLo(u8),
}

pub struct FifCard {
    name: String,
    pub tracks: u8,
    pub sectors: u8,
    pub sector_size: usize,
    pub drives: [Option<Vec<u8>>; 4],
    state: FifState,
    /// Address of the disk descriptor in system RAM (set via 0x10 protocol).
    pub desc_addr: Option<u16>,
    /// Set by the 4-byte protocol when the execute command (0x00) is received.
    /// Machine::step() clears this after performing the DMA.
    pub pending_execute: bool,
}

impl FifCard {
    pub fn new(
        name: impl Into<String>,
        tracks: u8,
        sectors: u8,
        sector_size: usize,
    ) -> Self {
        FifCard {
            name: name.into(),
            tracks,
            sectors,
            sector_size,
            drives: [None, None, None, None],
            state: FifState::Idle,
            desc_addr: None,
            pending_execute: false,
        }
    }

    pub fn insert_disk(&mut self, drive: usize, data: Vec<u8>) {
        if drive < 4 {
            self.drives[drive] = if data.is_empty() { None } else { Some(data) };
        }
    }

    fn sector_offset(&self, track: u8, sector: u8) -> Option<usize> {
        if track >= self.tracks || sector == 0 || sector > self.sectors {
            return None;
        }
        Some((track as usize * self.sectors as usize + (sector as usize - 1)) * self.sector_size)
    }

    /// Read one sector from the specified drive. Returns None on any error.
    pub fn execute_read(&self, track: u8, sector: u8, drive_idx: usize) -> Option<Vec<u8>> {
        let off = self.sector_offset(track, sector)?;
        let disk = self.drives.get(drive_idx)?.as_ref()?;
        if off + self.sector_size <= disk.len() {
            Some(disk[off..off + self.sector_size].to_vec())
        } else {
            None
        }
    }

    /// Write one sector to the specified drive. Returns false on any error.
    pub fn execute_write(&mut self, track: u8, sector: u8, drive_idx: usize, data: &[u8]) -> bool {
        if data.len() < self.sector_size {
            return false;
        }
        let off = match self.sector_offset(track, sector) {
            Some(o) => o,
            None => return false,
        };
        if let Some(Some(disk)) = self.drives.get_mut(drive_idx) {
            if off + self.sector_size <= disk.len() {
                disk[off..off + self.sector_size].copy_from_slice(&data[..self.sector_size]);
                return true;
            }
        }
        false
    }

    /// Decode one-hot drive bits → drive index (0-3). Returns None if invalid.
    pub fn decode_drive(bits: u8) -> Option<usize> {
        match bits {
            0x01 => Some(0),
            0x02 => Some(1),
            0x04 => Some(2),
            0x08 => Some(3),
            _ => None,
        }
    }
}

impl S100Card for FifCard {
    fn as_any(&self) -> &dyn Any { self }
    fn as_any_mut(&mut self) -> &mut dyn Any { self }
    fn name(&self) -> &str { &self.name }

    fn reset(&mut self) {
        self.state = FifState::Idle;
        self.pending_execute = false;
        // desc_addr and drives are preserved across reset
    }

    fn memory_read(&mut self, _addr: u16) -> Option<u8> { None }
    fn memory_write(&mut self, _addr: u16, _data: u8) {}

    fn io_read(&mut self, _port: u8) -> Option<u8> { None }

    fn io_write(&mut self, port: u8, data: u8) {
        match port {
            MBC_PORT | WP_PORT => { /* bank-switch / write-protect: no-op */ }
            FIF_PORT => {
                let next = match self.state {
                    FifState::Idle => match data {
                        0x10 => FifState::GotSetDesc,
                        0x00 => {
                            self.pending_execute = true;
                            FifState::Idle
                        }
                        _ => FifState::Idle,
                    },
                    FifState::GotSetDesc => FifState::GotAddrLo(data),
                    FifState::GotAddrLo(lo) => {
                        self.desc_addr = Some((data as u16) << 8 | lo as u16);
                        FifState::Idle
                    }
                };
                self.state = next;
            }
            _ => {}
        }
    }

    fn owns_io(&self, port: u8) -> bool {
        port == FIF_PORT || port == MBC_PORT || port == WP_PORT
    }
}
