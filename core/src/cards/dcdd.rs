// MITS 88-DCDD floppy disk controller emulation
// Hard-sector format: 77 tracks × 32 sectors × 137 bytes = 337,568 bytes
// Port protocol:
//   0x08 IN  = drive status (active-low bit fields)
//   0x08 OUT = drive select (bit7=deselect, bits3-0=drive number)
//   0x09 IN  = sector position: bits 5-1 = sector_counter, bit 0 = sector_true
//   0x09 OUT = disk control (step/head/write)
//   0x0A IN  = read data byte from current sector
//   0x0A OUT = write data byte to current sector

use std::any::Any;
use crate::card::S100Card;

const DSK_TRACKS:      usize = 77;
const DSK_SECTORS:     usize = 32;
const DSK_SECTOR_SIZE: usize = 137;

const PORT_STATUS:  u8 = 0x08;
const PORT_CONTROL: u8 = 0x09;
const PORT_DATA:    u8 = 0x0A;

pub struct Dcdd88Card {
    name: String,
    pub drives: [Option<Vec<u8>>; 4],
    current_drive: Option<usize>,
    current_track: [usize; 4],
    head_loaded:   [bool; 4],
    /// 0..31, advances when sector_true transitions to false
    sector_counter: u8,
    /// Toggles on each port 0x09 IN. When false: sector is positioned/ready.
    sector_true:    bool,
    /// Latched sector number for current data transfer
    read_sector:    u8,
    /// Byte position within the current 137-byte sector (0..136, wraps at 137)
    byte_pos:       usize,
    write_mode:     bool,
}

impl Dcdd88Card {
    pub fn new(name: impl Into<String>) -> Self {
        Dcdd88Card {
            name: name.into(),
            drives: [None, None, None, None],
            current_drive: None,
            current_track: [0; 4],
            head_loaded:   [false; 4],
            sector_counter: 0,
            sector_true:    false,
            read_sector:    0,
            byte_pos:       0,
            write_mode:     false,
        }
    }

    pub fn insert_disk(&mut self, drive: usize, data: Vec<u8>) {
        if drive < 4 {
            self.drives[drive] = if data.is_empty() { None } else { Some(data) };
        }
    }

    /// Return the status byte (all bits active-low).
    /// Bit 7 = R (data ready), bit 6 = Z (track 0), bit 2 = H (head loaded),
    /// bit 1 = M (movement allowed), bit 0 = W (write ready).
    fn status_byte(&self) -> u8 {
        let Some(drive) = self.current_drive else { return 0xFF };
        if self.drives[drive].is_none() { return 0xFF }

        let loaded = self.head_loaded[drive];
        let on_t0  = self.current_track[drive] == 0;

        let mut active: u8 = 0;
        if loaded { active |= 0x80; }  // R: data ready when head loaded
        if on_t0  { active |= 0x40; }  // Z: on track 0
        active |= 0x08;                // Motor: always running when disk selected
        if loaded { active |= 0x04; }  // H: head loaded
        active |= 0x02;                // M: movement always allowed
        active |= 0x01;                // W: write always ready
        !active                         // active-low: invert
    }

    /// Compute the byte offset into the disk image for the current track + read_sector.
    fn sector_byte_offset(&self) -> Option<usize> {
        let drive = self.current_drive?;
        let disk = self.drives[drive].as_ref()?;
        let sectors = if disk.len() >= DSK_TRACKS * DSK_SECTORS * DSK_SECTOR_SIZE {
            DSK_SECTORS
        } else {
            16  // mini-disk fallback
        };
        Some((self.current_track[drive] * sectors + self.read_sector as usize) * DSK_SECTOR_SIZE)
    }
}

impl S100Card for Dcdd88Card {
    fn name(&self) -> &str { &self.name }

    fn reset(&mut self) {
        self.current_drive  = None;
        self.current_track  = [0; 4];
        self.head_loaded    = [false; 4];
        self.sector_counter = 0;
        self.sector_true    = false;
        self.read_sector    = 0;
        self.byte_pos       = 0;
        self.write_mode     = false;
    }

    fn memory_read(&mut self, _addr: u16) -> Option<u8> { None }
    fn memory_write(&mut self, _addr: u16, _data: u8) {}

    fn io_read(&mut self, port: u8) -> Option<u8> {
        match port {
            PORT_STATUS => Some(self.status_byte()),

            PORT_CONTROL => {
                let Some(drive) = self.current_drive else { return Some(0xFF) };
                if self.drives[drive].is_none() { return Some(0xFF) }
                if !self.head_loaded[drive]     { return Some(0xFF) }

                // Encode: bits 5-1 = sector_counter, bit 0 = sector_true
                let val = (self.sector_counter << 1) | (self.sector_true as u8);

                // When positioned (sector_true currently false): latch sector + reset byte_pos
                if !self.sector_true {
                    self.read_sector = self.sector_counter;
                    self.byte_pos    = 0;
                }

                // Toggle sector_true
                self.sector_true = !self.sector_true;

                // Advance sector counter when it transitions back to false (not-ready)
                if !self.sector_true {
                    self.sector_counter = (self.sector_counter + 1) % DSK_SECTORS as u8;
                }

                Some(val)
            }

            PORT_DATA => {
                let Some(base) = self.sector_byte_offset() else { return Some(0xFF) };
                let Some(drive) = self.current_drive else { return Some(0xFF) };
                let disk = self.drives[drive].as_ref()?;

                let pos = base + self.byte_pos;
                let byte = if pos < disk.len() { disk[pos] } else { 0xFF };

                self.byte_pos += 1;
                if self.byte_pos >= DSK_SECTOR_SIZE { self.byte_pos = 0; }

                Some(byte)
            }

            _ => None,
        }
    }

    fn io_write(&mut self, port: u8, data: u8) {
        match port {
            PORT_STATUS => {
                if data & 0x80 != 0 {
                    // Deselect all drives
                    if let Some(drive) = self.current_drive {
                        self.head_loaded[drive] = false;
                    }
                    self.current_drive = None;
                    self.byte_pos  = 0;
                    self.write_mode = false;
                } else {
                    let drive = (data & 0x0F) as usize;
                    if drive < 4 {
                        self.current_drive = Some(drive);
                        self.byte_pos = 0;
                    }
                }
            }

            PORT_CONTROL => {
                let Some(drive) = self.current_drive else { return };

                if data & 0x04 != 0 {
                    // Load head
                    self.head_loaded[drive] = true;
                    self.byte_pos = 0;
                }
                if data & 0x08 != 0 {
                    // Unload head
                    self.head_loaded[drive] = false;
                    self.byte_pos = 0;
                }
                if data & 0x01 != 0 {
                    // Step in (toward higher track numbers)
                    if self.current_track[drive] + 1 < DSK_TRACKS {
                        self.current_track[drive] += 1;
                    }
                    self.byte_pos = 0;
                }
                if data & 0x02 != 0 {
                    // Step out (toward track 0)
                    if self.current_track[drive] > 0 {
                        self.current_track[drive] -= 1;
                    }
                    self.byte_pos = 0;
                }
                if data & 0x80 != 0 {
                    // Write enable
                    self.write_mode = true;
                    self.byte_pos = 0;
                }
            }

            PORT_DATA => {
                if !self.write_mode { return; }
                let Some(base) = self.sector_byte_offset() else { return };
                let Some(drive) = self.current_drive else { return };
                if let Some(disk) = self.drives[drive].as_mut() {
                    let pos = base + self.byte_pos;
                    if pos < disk.len() { disk[pos] = data; }
                }
                self.byte_pos += 1;
                if self.byte_pos >= DSK_SECTOR_SIZE {
                    self.byte_pos = 0;
                    self.write_mode = false;
                }
            }

            _ => {}
        }
    }

    fn as_any(&self)     -> &dyn Any     { self }
    fn as_any_mut(&mut self) -> &mut dyn Any { self }
}
