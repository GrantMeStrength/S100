use std::any::Any;
use crate::card::S100Card;

/// CP/M 8-inch disk geometry (standard single-density).
const TRACKS: u8 = 77;
const SECTORS_PER_TRACK: u8 = 26;
const SECTOR_SIZE: usize = 128;

/// I/O port assignments (matching Core8080Manager BIOS convention).
const PORT_SELECT: u8 = 0xF3;
const PORT_TRACK:  u8 = 0xF4;
const PORT_SECTOR: u8 = 0xF5;
const PORT_DMA_LO: u8 = 0xF6;
const PORT_DMA_HI: u8 = 0xF7;
const PORT_READ:   u8 = 0xF8; // io_read triggers disk read
const PORT_WRITE:  u8 = 0xF9; // io_read triggers disk write
const PORT_HOME:   u8 = 0xFA; // io_write homes disk head

/// Pending DMA transfer — produced by FDC, consumed by Machine.
pub struct DmaPending {
    /// True = sector data flows FROM disk TO memory (READ).
    /// False = sector data flows FROM memory TO disk (WRITE).
    pub is_read: bool,
    pub addr: u16,
    pub data: [u8; SECTOR_SIZE],
}

/// Floppy Disk Controller card.
///
/// Implements the trap-based I/O port scheme used by the Core8080Manager BIOS.
/// Disk images are stored as flat byte arrays (track * SPT + (sector-1)) * 128.
pub struct FloppyController {
    name: String,
    pub drives: [Option<Vec<u8>>; 4],
    pub selected_drive: usize,
    pub current_track: u8,
    pub current_sector: u8,
    pub dma_addr: u16,
    /// Populated after a READ/WRITE trigger; Machine drains this to perform DMA.
    pub pending_dma: Option<DmaPending>,
}

impl FloppyController {
    pub fn new(name: impl Into<String>) -> Self {
        FloppyController {
            name: name.into(),
            drives: [None, None, None, None],
            selected_drive: 0,
            current_track: 0,
            current_sector: 1,
            dma_addr: 0x0080,
            pending_dma: None,
        }
    }

    pub fn insert_disk(&mut self, drive: usize, data: Vec<u8>) {
        if drive < 4 {
            self.drives[drive] = Some(data);
        }
    }

    pub fn eject_disk(&mut self, drive: usize) {
        if drive < 4 {
            self.drives[drive] = None;
        }
    }

    /// Call after Machine drains pending_dma for a WRITE to commit sector to image.
    pub fn do_write(&mut self, data: &[u8; SECTOR_SIZE]) {
        let offset = self.sector_offset();
        let drive = self.selected_drive;
        if let Some(ref mut disk) = self.drives[drive] {
            if offset + SECTOR_SIZE <= disk.len() {
                disk[offset..offset + SECTOR_SIZE].copy_from_slice(data);
            }
        }
    }

    fn sector_offset(&self) -> usize {
        let track = self.current_track as usize;
        // Sectors are 1-indexed in CP/M
        let sector = self.current_sector.saturating_sub(1) as usize;
        (track * SECTORS_PER_TRACK as usize + sector) * SECTOR_SIZE
    }

    fn trigger_read(&mut self) -> u8 {
        let drive = self.selected_drive;
        if let Some(ref disk) = self.drives[drive] {
            let offset = self.sector_offset();
            if offset + SECTOR_SIZE <= disk.len() {
                let mut data = [0u8; SECTOR_SIZE];
                data.copy_from_slice(&disk[offset..offset + SECTOR_SIZE]);
                self.pending_dma = Some(DmaPending {
                    is_read: true,
                    addr: self.dma_addr,
                    data,
                });
                return 0; // success
            }
        }
        1 // error
    }

    fn trigger_write(&mut self) -> u8 {
        let drive = self.selected_drive;
        if self.drives[drive].is_some() {
            let offset = self.sector_offset();
            if let Some(ref disk) = self.drives[drive] {
                if offset + SECTOR_SIZE <= disk.len() {
                    // Signal Machine to collect data from memory and call do_write()
                    self.pending_dma = Some(DmaPending {
                        is_read: false,
                        addr: self.dma_addr,
                        data: [0u8; SECTOR_SIZE],
                    });
                    return 0; // success
                }
            }
        }
        1 // error
    }
}

impl S100Card for FloppyController {
    fn as_any(&self) -> &dyn Any { self }
    fn as_any_mut(&mut self) -> &mut dyn Any { self }
    fn name(&self) -> &str { &self.name }

    fn reset(&mut self) {
        self.selected_drive = 0;
        self.current_track = 0;
        self.current_sector = 1;
        self.dma_addr = 0x0080;
        self.pending_dma = None;
    }

    fn memory_read(&mut self, _addr: u16) -> Option<u8> { None }
    fn memory_write(&mut self, _addr: u16, _data: u8) {}

    fn io_read(&mut self, port: u8) -> Option<u8> {
        match port {
            PORT_READ  => Some(self.trigger_read()),
            PORT_WRITE => Some(self.trigger_write()),
            _ => None,
        }
    }

    fn io_write(&mut self, port: u8, data: u8) {
        match port {
            PORT_SELECT => {
                let drive = (data as usize) & 3;
                self.selected_drive = drive;
            }
            PORT_TRACK  => {
                if data < TRACKS { self.current_track = data; }
            }
            PORT_SECTOR => {
                if data >= 1 && data <= SECTORS_PER_TRACK {
                    self.current_sector = data;
                }
            }
            PORT_DMA_LO => {
                self.dma_addr = (self.dma_addr & 0xFF00) | (data as u16);
            }
            PORT_DMA_HI => {
                self.dma_addr = (self.dma_addr & 0x00FF) | ((data as u16) << 8);
            }
            PORT_HOME   => {
                self.current_track = 0;
            }
            _ => {}
        }
    }

    fn owns_io(&self, port: u8) -> bool {
        matches!(port, PORT_SELECT | PORT_TRACK | PORT_SECTOR |
                       PORT_DMA_LO | PORT_DMA_HI | PORT_READ |
                       PORT_WRITE  | PORT_HOME)
    }
}
