use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OpKind {
    MemRead,
    MemWrite,
    IoRead,
    IoWrite,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceEntry {
    pub cycle: u64,
    pub address: u16,
    pub data: u8,
    pub op: OpKind,
    pub source: String,
}

pub struct TraceBuffer {
    entries: VecDeque<TraceEntry>,
    capacity: usize,
    total_written: u64,
}

impl TraceBuffer {
    pub fn new(capacity: usize) -> Self {
        TraceBuffer {
            entries: VecDeque::with_capacity(capacity),
            capacity,
            total_written: 0,
        }
    }

    pub fn push(&mut self, entry: TraceEntry) {
        if self.entries.len() == self.capacity {
            self.entries.pop_front();
        }
        self.entries.push_back(entry);
        self.total_written += 1;
    }

    /// Return entries after `since_index` (up to `limit`).
    pub fn since(&self, since_index: u64, limit: usize) -> Vec<&TraceEntry> {
        let start = if self.total_written > since_index {
            self.total_written - since_index
        } else {
            0
        };
        // How many entries are before `since_index`?
        let skip = if start > self.entries.len() as u64 {
            self.entries.len()
        } else {
            (self.entries.len() as u64 - start) as usize
        };
        self.entries
            .iter()
            .skip(skip)
            .take(limit)
            .collect()
    }

    pub fn total_written(&self) -> u64 {
        self.total_written
    }

    pub fn all(&self) -> &VecDeque<TraceEntry> {
        &self.entries
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.total_written = 0;
    }
}
