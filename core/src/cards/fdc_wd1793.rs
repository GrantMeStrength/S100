// WD1793 Floppy Disk Controller emulation
//
// This is the most common FDC chip used in S-100 systems other than the Altair:
// IMSAI 8080, Cromemco, Processor Technology, etc.
//
// Port layout (base_port configurable, default 0x34):
//   base+0  Status (IN)  / Command (OUT)
//   base+1  Track register (IN/OUT)
//   base+2  Sector register (IN/OUT)
//   base+3  Data register (IN/OUT)
//   drive_select_port (OUT): bit0=driveA, bit1=driveB, bit2=driveC, bit3=driveD
//
// Status register bits:
//   Bit 7: Not Ready (1 = no disk in selected drive)
//   Bit 5: Record Not Found (type II: sector not found)
//   Bit 2: Track 0 (type I: head is on track 0)
//   Bit 1: DRQ (data request — byte ready to read/write)
//   Bit 0: Busy
//
// Disk image format: flat binary, 0-indexed tracks, 1-indexed sectors
//   Offset = (track × sectors_per_track + sector - 1) × sector_size

use std::any::Any;
use crate::card::S100Card;

enum FdcState {
    Idle { rnf: bool },
    ReadSector { buf: Vec<u8>, pos: usize },
    WriteSector { track: u8, sector: u8, drive: usize, buf: Vec<u8> },
}

pub struct WD1793Card {
    name: String,
    // Configurable port layout
    base_port: u8,
    drive_select_port: u8,
    // Disk geometry
    tracks: u8,
    sectors: u8,
    sector_size: usize,
    // Drive state
    pub drives: [Option<Vec<u8>>; 4],
    selected_drive: usize,
    // WD1793 registers
    track_reg: u8,
    sector_reg: u8,
    data_reg: u8,    // also used as Seek target
    head_track: u8,  // physical head position
    last_dir: i8,    // +1 = in (higher), -1 = out (lower)
    // Command state
    state: FdcState,
}

impl WD1793Card {
    pub fn new(
        name: impl Into<String>,
        base_port: u8,
        drive_select_port: u8,
        tracks: u8,
        sectors: u8,
        sector_size: usize,
    ) -> Self {
        WD1793Card {
            name: name.into(),
            base_port,
            drive_select_port,
            tracks,
            sectors,
            sector_size,
            drives: [None, None, None, None],
            selected_drive: 0,
            track_reg: 0,
            sector_reg: 1,
            data_reg: 0,
            head_track: 0,
            last_dir: 1,
            state: FdcState::Idle { rnf: false },
        }
    }

    pub fn insert_disk(&mut self, drive: usize, data: Vec<u8>) {
        if drive < 4 {
            self.drives[drive] = if data.is_empty() { None } else { Some(data) };
        }
    }

    fn drive_ready(&self) -> bool {
        self.drives[self.selected_drive].is_some()
    }

    fn not_ready_bit(&self) -> u8 {
        if self.drive_ready() { 0 } else { 0x80 }
    }

    fn status(&self) -> u8 {
        match &self.state {
            FdcState::Idle { rnf } => {
                self.not_ready_bit()
                    | if self.head_track == 0 { 0x04 } else { 0 }
                    | if *rnf { 0x10 } else { 0 }
            }
            FdcState::ReadSector { pos, buf } => {
                let drq = if *pos < buf.len() { 0x02 } else { 0 };
                0x01 | drq | self.not_ready_bit()
            }
            FdcState::WriteSector { .. } => {
                // DRQ=1 signals "ready for next byte"
                0x01 | 0x02 | self.not_ready_bit()
            }
        }
    }

    fn sector_offset(&self, track: u8, sector: u8) -> Option<usize> {
        if track >= self.tracks || sector == 0 || sector > self.sectors {
            return None;
        }
        Some((track as usize * self.sectors as usize + sector as usize - 1) * self.sector_size)
    }

    fn execute_command(&mut self, cmd: u8) {
        // Type IV: Force Interrupt — always resets to idle
        if cmd & 0xF0 == 0xD0 {
            self.state = FdcState::Idle { rnf: false };
            return;
        }

        // Clear RNF before any new command
        match cmd >> 4 {
            // ── Type I: Seek operations ─────────────────────────────────────
            0x0 => {
                // Restore: seek to track 0
                self.head_track = 0;
                self.track_reg = 0;
                self.last_dir = -1;
                self.state = FdcState::Idle { rnf: false };
            }
            0x1 => {
                // Seek: target track is in Data Register
                let target = self.data_reg.min(self.tracks.saturating_sub(1));
                self.last_dir = if target >= self.head_track { 1 } else { -1 };
                self.head_track = target;
                self.track_reg = target;
                self.state = FdcState::Idle { rnf: false };
            }
            0x2 | 0x3 => {
                // Step (repeat last direction)
                let update = cmd & 0x10 != 0;
                self.head_track = ((self.head_track as i16 + self.last_dir as i16)
                    .clamp(0, self.tracks as i16 - 1)) as u8;
                if update { self.track_reg = self.head_track; }
                self.state = FdcState::Idle { rnf: false };
            }
            0x4 | 0x5 => {
                // Step In (toward higher tracks)
                let update = cmd & 0x10 != 0;
                self.last_dir = 1;
                self.head_track = (self.head_track + 1).min(self.tracks - 1);
                if update { self.track_reg = self.head_track; }
                self.state = FdcState::Idle { rnf: false };
            }
            0x6 | 0x7 => {
                // Step Out (toward track 0)
                let update = cmd & 0x10 != 0;
                self.last_dir = -1;
                self.head_track = self.head_track.saturating_sub(1);
                if update { self.track_reg = self.head_track; }
                self.state = FdcState::Idle { rnf: false };
            }

            // ── Type II: Data transfer ──────────────────────────────────────
            0x8 | 0x9 => {
                // Read Sector (0x80–0x9F)
                if !self.drive_ready() {
                    self.state = FdcState::Idle { rnf: false };
                    return;
                }
                let offset = self.sector_offset(self.track_reg, self.sector_reg);
                if let Some(off) = offset {
                    if let Some(disk) = &self.drives[self.selected_drive] {
                        if off + self.sector_size <= disk.len() {
                            let buf = disk[off..off + self.sector_size].to_vec();
                            self.state = FdcState::ReadSector { buf, pos: 0 };
                            return;
                        }
                    }
                }
                // Sector not found
                self.state = FdcState::Idle { rnf: true };
            }
            0xA | 0xB => {
                // Write Sector (0xA0–0xBF)
                if !self.drive_ready() {
                    self.state = FdcState::Idle { rnf: false };
                    return;
                }
                self.state = FdcState::WriteSector {
                    track: self.track_reg,
                    sector: self.sector_reg,
                    drive: self.selected_drive,
                    buf: Vec::with_capacity(self.sector_size),
                };
            }
            _ => {
                self.state = FdcState::Idle { rnf: false };
            }
        }
    }

    fn io_read_data(&mut self) -> u8 {
        match &mut self.state {
            FdcState::ReadSector { buf, pos } => {
                if *pos < buf.len() {
                    let byte = buf[*pos];
                    *pos += 1;
                    // If transfer complete, return to idle after this read
                    let done = *pos >= buf.len();
                    let byte = byte;
                    if done {
                        self.state = FdcState::Idle { rnf: false };
                    }
                    byte
                } else {
                    0xFF
                }
            }
            _ => self.data_reg,
        }
    }

    fn io_write_data(&mut self, data: u8) {
        self.data_reg = data;
        if let FdcState::WriteSector { buf, track, sector, drive } = &mut self.state {
            buf.push(data);
            if buf.len() >= self.sector_size {
                // Flush write to disk
                let t = *track;
                let s = *sector;
                let d = *drive;
                let buf = std::mem::take(buf);
                if let Some(off) = self.sector_offset(t, s) {
                    if let Some(disk) = self.drives[d].as_mut() {
                        if off + self.sector_size <= disk.len() {
                            disk[off..off + self.sector_size].copy_from_slice(&buf);
                        }
                    }
                }
                self.state = FdcState::Idle { rnf: false };
            }
        }
    }
}

impl S100Card for WD1793Card {
    fn as_any(&self) -> &dyn Any { self }
    fn as_any_mut(&mut self) -> &mut dyn Any { self }
    fn name(&self) -> &str { &self.name }

    fn reset(&mut self) {
        self.track_reg = 0;
        self.sector_reg = 1;
        self.data_reg = 0;
        self.head_track = 0;
        self.last_dir = 1;
        self.state = FdcState::Idle { rnf: false };
        // Drives retain disk data across reset
    }

    fn memory_read(&mut self, _addr: u16) -> Option<u8> { None }
    fn memory_write(&mut self, _addr: u16, _data: u8) {}

    fn io_read(&mut self, port: u8) -> Option<u8> {
        let offset = port.wrapping_sub(self.base_port);
        match offset {
            0 => Some(self.status()),
            1 => Some(self.track_reg),
            2 => Some(self.sector_reg),
            3 => Some(self.io_read_data()),
            _ => None,
        }
    }

    fn io_write(&mut self, port: u8, data: u8) {
        if port == self.drive_select_port {
            // One-hot drive select: bit0=A, bit1=B, bit2=C, bit3=D
            self.selected_drive = match data & 0x0F {
                d if d & 0x01 != 0 => 0,
                d if d & 0x02 != 0 => 1,
                d if d & 0x04 != 0 => 2,
                d if d & 0x08 != 0 => 3,
                _ => self.selected_drive, // no change if nothing selected
            };
            return;
        }
        let offset = port.wrapping_sub(self.base_port);
        match offset {
            0 => self.execute_command(data),
            1 => self.track_reg = data,
            2 => self.sector_reg = data,
            3 => self.io_write_data(data),
            _ => {}
        }
    }

    fn owns_io(&self, port: u8) -> bool {
        port == self.drive_select_port
            || port.wrapping_sub(self.base_port) < 4
    }
}
