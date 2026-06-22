#!/usr/bin/env python3
"""
LANDER — A Lunar Lander game for the Cromemco Dazzler + D+7A joystick.
Builds a CP/M .COM file (Z80 machine code, ORG 0x0100).

Display: 64×64 color, 2K normal mode (16 IBGR colors)
Framebuffer: 0x2000 (page 0x10), 2048 bytes
  4 quadrants of 512 bytes: TL, TR, BL, BR
  Each quadrant: 32×32 pixels, 16 bytes/row, 2 px/byte (low nib=left, high=right)

Joystick: Cromemco D+7A
  Port 0x18: buttons (active-LOW, bit0=exit, bit1=thrust)
  Port 0x19: X-axis (0=center, 1-127=right, 128-255=left)
  Port 0x1A: Y-axis
"""

import os, sys

# ─── Mini Z80 assembler (same as MAZECHASE) ────────────────────────────────────

class Z80:
    def __init__(self, org=0x0100):
        self.org = org
        self.code = bytearray()
        self.labels = {}
        self.fixups = []

    @property
    def pc(self):
        return self.org + len(self.code)

    def label(self, name):
        if name in self.labels:
            raise ValueError(f"Duplicate label: {name}")
        self.labels[name] = self.pc

    def emit(self, *bs):
        for b in bs:
            self.code.append(b & 0xFF)

    def emit16(self, v):
        self.emit(v & 0xFF, (v >> 8) & 0xFF)

    def db(self, *vals):
        for v in vals:
            if isinstance(v, (bytes, bytearray)):
                self.code.extend(v)
            elif isinstance(v, str):
                self.code.extend(v.encode('ascii'))
            else:
                self.emit(v)

    def ds(self, n, fill=0):
        self.code.extend([fill] * n)

    def _ref16(self, lbl):
        self.fixups.append((len(self.code), lbl, 16))
        self.emit16(0)

    def _ref8(self, lbl):
        self.fixups.append((len(self.code), lbl, 8))
        self.emit(0)

    def resolve(self):
        for off, lbl, bits in self.fixups:
            if lbl not in self.labels:
                raise ValueError(f"Undefined label: {lbl}")
            addr = self.labels[lbl]
            if bits == 16:
                self.code[off] = addr & 0xFF
                self.code[off+1] = (addr >> 8) & 0xFF
            else:
                rel = addr - (self.org + off + 1)
                if rel < -128 or rel > 127:
                    raise ValueError(f"JR out of range: {lbl} (offset {rel})")
                self.code[off] = rel & 0xFF

    def save(self, path):
        self.resolve()
        with open(path, 'wb') as f:
            f.write(self.code)
        print(f"Written {len(self.code)} bytes → {path}")

    # Register encodings
    R = {'b':0,'c':1,'d':2,'e':3,'h':4,'l':5,'(hl)':6,'a':7}
    RP = {'bc':0,'de':1,'hl':2,'sp':3}
    RP2 = {'bc':0,'de':1,'hl':2,'af':3}
    CC = {'nz':0,'z':1,'nc':2,'c':3}

    # Instructions
    def nop(self): self.emit(0x00)
    def di(self): self.emit(0xF3)
    def ei(self): self.emit(0xFB)
    def ret(self): self.emit(0xC9)
    def cpl(self): self.emit(0x2F)
    def halt(self): self.emit(0x76)
    def daa(self): self.emit(0x27)

    def ld_r_r(self, d, s): self.emit(0x40 + self.R[d]*8 + self.R[s])
    def ld_r_n(self, r, n): self.emit(0x06 + self.R[r]*8, n & 0xFF)
    def ld_rp_nn(self, rp, nn): self.emit(0x01 + self.RP[rp]*16); self.emit16(nn)
    def ld_rp_label(self, rp, lbl): self.emit(0x01 + self.RP[rp]*16); self._ref16(lbl)
    def ld_a_addr(self, addr): self.emit(0x3A); self.emit16(addr)
    def ld_a_lbl(self, lbl): self.emit(0x3A); self._ref16(lbl)
    def ld_lbl_a(self, lbl): self.emit(0x32); self._ref16(lbl)
    def ld_a_de(self): self.emit(0x1A)
    def ld_de_a(self): self.emit(0x12)
    def ld_sp_hl(self): self.emit(0xF9)
    def ld_hl_r(self, r): self.emit(0x70 + self.R[r])  # LD (HL), r
    def ld_r_hl(self, r): self.emit(0x46 + self.R[r]*8)  # LD r, (HL)

    def push(self, rp): self.emit(0xC5 + self.RP2[rp]*16)
    def pop(self, rp): self.emit(0xC1 + self.RP2[rp]*16)

    def inc_r(self, r): self.emit(0x04 + self.R[r]*8)
    def dec_r(self, r): self.emit(0x05 + self.R[r]*8)
    def inc_rp(self, rp): self.emit(0x03 + self.RP[rp]*16)
    def dec_rp(self, rp): self.emit(0x0B + self.RP[rp]*16)

    def add_a_r(self, r): self.emit(0x80 + self.R[r])
    def add_a_n(self, n): self.emit(0xC6, n & 0xFF)
    def adc_a_r(self, r): self.emit(0x88 + self.R[r])
    def sub_r(self, r): self.emit(0x90 + self.R[r])
    def sub_n(self, n): self.emit(0xD6, n & 0xFF)
    def and_r(self, r): self.emit(0xA0 + self.R[r])
    def and_n(self, n): self.emit(0xE6, n & 0xFF)
    def or_r(self, r): self.emit(0xB0 + self.R[r])
    def or_n(self, n): self.emit(0xF6, n & 0xFF)
    def xor_r(self, r): self.emit(0xA8 + self.R[r])
    def xor_n(self, n): self.emit(0xEE, n & 0xFF)
    def cp_r(self, r): self.emit(0xB8 + self.R[r])
    def cp_n(self, n): self.emit(0xFE, n & 0xFF)
    def add_hl_rp(self, rp): self.emit(0x09 + self.RP[rp]*16)

    def in_a(self, p): self.emit(0xDB, p & 0xFF)
    def out_a(self, p): self.emit(0xD3, p & 0xFF)

    def jr(self, cc_or_lbl, lbl2=None):
        if lbl2: self.emit(0x20 + self.CC[cc_or_lbl]*8); self._ref8(lbl2)
        else:    self.emit(0x18); self._ref8(cc_or_lbl)

    def jp(self, cc_or_lbl, lbl2=None):
        if lbl2: self.emit(0xC2 + self.CC[cc_or_lbl]*8); self._ref16(lbl2)
        else:    self.emit(0xC3); self._ref16(cc_or_lbl)

    def call(self, cc_or_lbl, lbl2=None):
        if lbl2: self.emit(0xC4 + self.CC[cc_or_lbl]*8); self._ref16(lbl2)
        else:    self.emit(0xCD); self._ref16(cc_or_lbl)

    def ret_cc(self, cc): self.emit(0xC0 + self.CC[cc]*8)
    def djnz(self, lbl): self.emit(0x10); self._ref8(lbl)
    def jp_hl(self): self.emit(0xE9)

    def srl(self, r): self.emit(0xCB, 0x38 + self.R[r])
    def sla(self, r): self.emit(0xCB, 0x20 + self.R[r])
    def rl(self, r):  self.emit(0xCB, 0x10 + self.R[r])
    def rr(self, r):  self.emit(0xCB, 0x18 + self.R[r])
    def bit(self, b, r): self.emit(0xCB, 0x40 + b*8 + self.R[r])
    def set_bit(self, b, r): self.emit(0xCB, 0xC0 + b*8 + self.R[r])
    def res_bit(self, b, r): self.emit(0xCB, 0x80 + b*8 + self.R[r])
    def rra(self): self.emit(0x1F)
    def rla(self): self.emit(0x17)
    def rlca(self): self.emit(0x07)
    def rrca(self): self.emit(0x0F)

    def ldir(self): self.emit(0xED, 0xB0)
    def neg(self): self.emit(0xED, 0x44)

# ─── Constants ──────────────────────────────────────────────────────────────────
DAZ_NX, DAZ_CC = 0x0E, 0x0F
FB_BASE = 0x2000
FB_PAGE = 0x10
FB_SIZE = 2048
JOY_BTN, JOY_X, JOY_Y = 0x18, 0x19, 0x1A

BLACK, RED, GREEN, YELLOW = 0, 1, 2, 3
BLUE, MAGENTA, CYAN, WHITE = 4, 5, 6, 7
BRIGHT = 8
BRIGHT_RED = RED | BRIGHT
BRIGHT_GREEN = GREEN | BRIGHT
BRIGHT_YELLOW = YELLOW | BRIGHT
BRIGHT_WHITE = WHITE | BRIGHT

PAD1_START, PAD1_END = 18, 25
PAD2_START, PAD2_END = 42, 49

TERRAIN = (
    [8] * 8 +
    [9] * 8 +
    [10] * 2 +
    [8] * 8 +
    [9] * 8 +
    [11] * 8 +
    [7] * 8 +
    [9] * 6 +
    [10] * 8
)
assert len(TERRAIN) == 64

STARS = [
    (3, 4), (9, 8), (14, 2), (21, 11),
    (28, 6), (35, 13), (41, 5), (48, 9),
    (55, 3), (60, 15), (12, 18), (25, 20),
    (38, 17), (52, 22),
]

a = Z80()

# ─── Python emission helpers ───────────────────────────────────────────────────

def plot_imm(x, y, color):
    a.ld_r_n('d', x)
    a.ld_r_n('e', y)
    a.ld_r_n('c', color)
    a.call('plot')


def hline_imm(x, y, w, color):
    if w <= 0:
        return
    a.ld_r_n('d', x)
    a.ld_r_n('e', y)
    a.ld_r_n('b', w)
    a.ld_r_n('c', color)
    a.call('hline')


def emit_terrain_lines():
    start = 0
    while start < 64:
        height = TERRAIN[start]
        on_pad = PAD1_START <= start <= PAD1_END or PAD2_START <= start <= PAD2_END
        end = start + 1
        while end < 64:
            same_height = TERRAIN[end] == height
            same_pad = (PAD1_START <= end <= PAD1_END or PAD2_START <= end <= PAD2_END) == on_pad
            if not (same_height and same_pad):
                break
            end += 1
        color = BRIGHT_GREEN if on_pad else WHITE
        hline_imm(start, 64 - height, end - start, color)
        start = end


def emit_game_over_x():
    for x in range(64):
        plot_imm(x, x, BRIGHT_RED)
        plot_imm(x, 63 - x, BRIGHT_RED)

# ─── Entry ─────────────────────────────────────────────────────────────────────
a.label('start')
a.di()
a.ld_rp_nn('sp', 0x1F00)
a.ld_r_n('a', 0x30)
a.out_a(DAZ_CC)
a.ld_r_n('a', 0x80 | FB_PAGE)
a.out_a(DAZ_NX)
a.in_a(DAZ_NX)
a.ld_lbl_a('rng')
a.call('init_game')

a.label('main_loop')
a.call('vsync')
a.call('poll_exit')
a.ld_a_lbl('frame_ctr')
a.inc_r('a')
a.ld_lbl_a('frame_ctr')

a.ld_a_lbl('game_over_timer')
a.or_r('a')
a.jp('nz', 'game_over_frame')
a.ld_a_lbl('explosion_timer')
a.or_r('a')
a.jp('nz', 'explosion_frame')
a.ld_a_lbl('success_timer')
a.or_r('a')
a.jp('nz', 'success_frame')

a.call('erase_lander')
a.call('erase_flame')
a.call('erase_hud')
a.call('read_input')
a.call('apply_gravity')
a.call('apply_thrust')
a.call('move_lander')
a.call('draw_hud')
a.call('check_touchdown')

a.ld_a_lbl('explosion_timer')
a.or_r('a')
a.jp('nz', 'explosion_first')
a.ld_a_lbl('success_timer')
a.or_r('a')
a.jp('nz', 'success_first')
a.call('draw_lander_white')
a.call('draw_flame')
a.jp('main_loop')

a.label('explosion_first')
a.call('draw_explosion')
a.jp('main_loop')

a.label('success_first')
a.call('draw_lander_green')
a.jp('main_loop')

a.label('success_frame')
a.call('flash_success')
a.call('tick_success')
a.jp('main_loop')

a.label('explosion_frame')
a.call('draw_explosion')
a.call('tick_explosion')
a.jp('main_loop')

a.label('game_over_frame')
a.call('tick_game_over')
a.jp('main_loop')

# ═══════════════════════════════════════════════════════════════════════════════
#  SUBROUTINES
# ═══════════════════════════════════════════════════════════════════════════════

a.label('poll_exit')
a.in_a(JOY_BTN)
a.bit(0, 'a')
a.jp('z', 'exit_to_cpm')
a.ret()

a.label('init_game')
a.xor_r('a')
a.ld_lbl_a('score')
a.ld_lbl_a('frame_ctr')
a.ld_lbl_a('success_timer')
a.ld_lbl_a('explosion_timer')
a.ld_lbl_a('game_over_timer')
a.ld_r_n('a', 3)
a.ld_lbl_a('lives')
a.call('init_round')
a.ret()

a.label('init_round')
a.ld_r_n('a', 32)
a.ld_lbl_a('lander_x')
a.ld_r_n('a', 4)
a.ld_lbl_a('lander_y')
a.xor_r('a')
a.ld_lbl_a('vx')
a.ld_lbl_a('vy')
a.ld_lbl_a('move_ctr')
a.ld_lbl_a('hm_ctr')
a.ld_lbl_a('grav_ctr')
a.ld_lbl_a('thrust_req')
a.ld_lbl_a('flame_on')
a.ld_lbl_a('success_timer')
a.ld_lbl_a('explosion_timer')
a.ld_lbl_a('game_over_timer')
a.ld_r_n('a', 255)
a.ld_lbl_a('fuel')
a.call('clear_fb')
a.call('draw_stars')
a.call('draw_terrain')
a.call('draw_hud')
a.call('draw_lander_white')
a.ret()

a.label('draw_stars')
for sx, sy in STARS:
    plot_imm(sx, sy, WHITE)
a.ret()

a.label('draw_terrain')
emit_terrain_lines()
a.ret()

a.label('erase_hud')
hline_imm(1, 1, 16, BLACK)
hline_imm(48, 1, 16, BLACK)
a.ret()

a.label('draw_hud')
a.ld_a_lbl('fuel')
a.or_r('a')
a.jp('z', 'dh_speed')
a.srl('a')
a.srl('a')
a.srl('a')
a.srl('a')
a.inc_r('a')
a.ld_r_r('b', 'a')
a.ld_r_n('d', 1)
a.ld_r_n('e', 1)
a.ld_r_n('c', BRIGHT_GREEN)
a.call('hline')
a.label('dh_speed')
a.ld_a_lbl('vy')
a.or_r('a')
a.ret_cc('z')
a.ld_r_r('b', 'a')
a.cp_n(3)
a.ld_r_n('c', BRIGHT_GREEN)
a.jp('c', 'dh_color_ok')
a.ld_r_n('c', BRIGHT_RED)
a.label('dh_color_ok')
a.ld_r_n('a', 64)
a.sub_r('b')
a.ld_r_r('d', 'a')
a.ld_r_n('e', 1)
a.call('hline')
a.ret()

a.label('draw_lander_core')
a.ld_a_lbl('lander_x')
a.ld_r_r('d', 'a')
a.ld_a_lbl('lander_y')
a.ld_r_r('e', 'a')
a.call('plot')
a.dec_r('d')
a.call('plot')
a.inc_r('d')
a.inc_r('d')
a.call('plot')
a.dec_r('d')
a.dec_r('d')
a.inc_r('e')
a.call('plot')
a.inc_r('d')
a.inc_r('d')
a.call('plot')
a.ret()

a.label('erase_lander')
a.ld_r_n('c', BLACK)
a.jp('draw_lander_core')

a.label('draw_lander_white')
a.ld_r_n('c', BRIGHT_WHITE)
a.jp('draw_lander_core')

a.label('draw_lander_green')
a.ld_r_n('c', BRIGHT_GREEN)
a.jp('draw_lander_core')

a.label('flame_core')
a.ld_a_lbl('lander_x')
a.ld_r_r('d', 'a')
a.ld_a_lbl('lander_y')
a.add_a_n(2)
a.ld_r_r('e', 'a')
a.call('plot')
a.ret()

a.label('erase_flame')
a.ld_r_n('c', BLACK)
a.jp('flame_core')

a.label('draw_flame')
a.ld_a_lbl('flame_on')
a.or_r('a')
a.ret_cc('z')
a.ld_r_n('c', BRIGHT_YELLOW)
a.jp('flame_core')

a.label('read_input')
a.in_a(JOY_BTN)
a.bit(1, 'a')
a.ld_r_n('a', 1)
a.jp('z', 'ri_store_thr')
a.xor_r('a')
a.label('ri_store_thr')
a.ld_lbl_a('thrust_req')

a.in_a(JOY_X)
a.or_r('a')
a.jp('z', 'ri_center')
a.cp_n(128)
a.jp('nc', 'ri_left')

a.label('ri_right')
a.ld_a_lbl('vx')
a.cp_n(4)
a.jp('z', 'ri_done')
a.inc_r('a')
a.ld_lbl_a('vx')
a.jp('ri_done')

a.label('ri_left')
a.ld_a_lbl('vx')
a.cp_n(0xFC)
a.jp('z', 'ri_done')
a.dec_r('a')
a.ld_lbl_a('vx')
a.jp('ri_done')

a.label('ri_center')
a.ld_a_lbl('vx')
a.or_r('a')
a.jp('z', 'ri_done')
a.cp_n(128)
a.jp('c', 'ri_center_pos')
a.inc_r('a')
a.ld_lbl_a('vx')
a.jp('ri_done')

a.label('ri_center_pos')
a.dec_r('a')
a.ld_lbl_a('vx')

a.label('ri_done')
a.ret()

a.label('apply_gravity')
a.ld_a_lbl('grav_ctr')
a.inc_r('a')
a.ld_lbl_a('grav_ctr')
a.cp_n(8)
a.ret_cc('c')
a.xor_r('a')
a.ld_lbl_a('grav_ctr')
a.ld_a_lbl('vy')
a.cp_n(15)
a.ret_cc('nc')
a.inc_r('a')
a.ld_lbl_a('vy')
a.ret()

a.label('apply_thrust')
a.xor_r('a')
a.ld_lbl_a('flame_on')
a.ld_a_lbl('thrust_req')
a.or_r('a')
a.ret_cc('z')
a.ld_a_lbl('fuel')
a.or_r('a')
a.ret_cc('z')
a.dec_r('a')
a.ld_lbl_a('fuel')
a.ld_a_lbl('vy')
a.or_r('a')
a.jp('z', 'at_set_flame')
a.dec_r('a')
a.ld_lbl_a('vy')
a.label('at_set_flame')
a.ld_r_n('a', 1)
a.ld_lbl_a('flame_on')
a.ret()

a.label('move_lander')
a.call('move_horizontal')
a.call('move_vertical')
a.ret()

a.label('move_horizontal')
a.ld_a_lbl('vx')
a.or_r('a')
a.ret_cc('z')
a.cp_n(128)
a.jp('c', 'mh_positive')

a.neg()
a.ld_r_r('b', 'a')
a.ld_a_lbl('hm_ctr')
a.inc_r('a')
a.ld_lbl_a('hm_ctr')
a.ld_r_n('a', 5)
a.sub_r('b')
a.ld_r_r('b', 'a')
a.ld_a_lbl('hm_ctr')
a.cp_r('b')
a.ret_cc('c')
a.xor_r('a')
a.ld_lbl_a('hm_ctr')
a.ld_a_lbl('lander_x')
a.cp_n(2)
a.ret_cc('c')
a.dec_r('a')
a.ld_lbl_a('lander_x')
a.ret()

a.label('mh_positive')
a.ld_r_r('b', 'a')
a.ld_a_lbl('hm_ctr')
a.inc_r('a')
a.ld_lbl_a('hm_ctr')
a.ld_r_n('a', 5)
a.sub_r('b')
a.ld_r_r('b', 'a')
a.ld_a_lbl('hm_ctr')
a.cp_r('b')
a.ret_cc('c')
a.xor_r('a')
a.ld_lbl_a('hm_ctr')
a.ld_a_lbl('lander_x')
a.cp_n(62)
a.ret_cc('nc')
a.inc_r('a')
a.ld_lbl_a('lander_x')
a.ret()

a.label('move_vertical')
a.ld_a_lbl('move_ctr')
a.inc_r('a')
a.ld_lbl_a('move_ctr')
a.ld_r_n('b', 16)
a.ld_a_lbl('vy')
a.ld_r_r('c', 'a')
a.ld_r_r('a', 'b')
a.sub_r('c')
a.ld_r_r('b', 'a')
a.ld_a_lbl('move_ctr')
a.cp_r('b')
a.ret_cc('c')
a.xor_r('a')
a.ld_lbl_a('move_ctr')
a.ld_a_lbl('lander_y')
a.cp_n(63)
a.ret_cc('nc')
a.inc_r('a')
a.ld_lbl_a('lander_y')
a.ret()

a.label('check_touchdown')
a.ld_a_lbl('lander_y')
a.cp_n(63)
a.jp('nc', 'start_crash')
a.inc_r('a')
a.ld_r_r('b', 'a')
a.ld_a_lbl('lander_x')
a.call('get_ground_y')
a.cp_r('b')
a.jp('c', 'ct_hit')
a.jp('z', 'ct_hit')
a.ret()

a.label('ct_hit')
a.ld_a_lbl('lander_x')
a.call('is_pad_column')
a.or_r('a')
a.jp('z', 'start_crash')
a.ld_a_lbl('vy')
a.cp_n(3)
a.jp('c', 'start_success')
a.jp('start_crash')

a.label('start_success')
a.xor_r('a')
a.ld_lbl_a('flame_on')
a.ld_r_n('a', 24)
a.ld_lbl_a('success_timer')
a.ld_a_lbl('score')
a.add_a_n(10)
a.ld_lbl_a('score')
a.ret()

a.label('flash_success')
a.ld_a_lbl('frame_ctr')
a.and_n(0x04)
a.jp('z', 'fs_green')
a.call('erase_lander')
a.ret()
a.label('fs_green')
a.call('draw_lander_green')
a.ret()

a.label('tick_success')
a.ld_a_lbl('success_timer')
a.dec_r('a')
a.ld_lbl_a('success_timer')
a.or_r('a')
a.ret_cc('nz')
a.call('init_round')
a.ret()

a.label('start_crash')
a.xor_r('a')
a.ld_lbl_a('flame_on')
a.ld_a_lbl('lander_x')
a.ld_lbl_a('boom_x')
a.ld_a_lbl('lander_y')
a.ld_lbl_a('boom_y')
a.ld_r_n('a', 30)
a.ld_lbl_a('explosion_timer')
a.ld_a_lbl('lives')
a.dec_r('a')
a.ld_lbl_a('lives')
a.ret()

a.label('draw_explosion')
a.call('draw_explosion_dot')
a.call('draw_explosion_dot')
a.call('draw_explosion_dot')
a.call('draw_explosion_dot')
a.call('draw_explosion_dot')
a.call('draw_explosion_dot')
a.ret()

a.label('draw_explosion_dot')
a.call('rand8')
a.ld_r_r('b', 'a')
a.and_n(7)
a.sub_n(3)
a.ld_r_r('c', 'a')
a.ld_a_lbl('boom_x')
a.add_a_r('c')
a.ld_r_r('d', 'a')
a.ld_r_r('a', 'b')
a.srl('a')
a.srl('a')
a.srl('a')
a.and_n(7)
a.sub_n(3)
a.ld_r_r('c', 'a')
a.ld_a_lbl('boom_y')
a.add_a_r('c')
a.ld_r_r('e', 'a')
a.bit(0, 'b')
a.ld_r_n('c', BRIGHT_RED)
a.jp('z', 'ded_plot')
a.ld_r_n('c', BRIGHT_YELLOW)
a.label('ded_plot')
a.call('plot')
a.ret()

a.label('tick_explosion')
a.ld_a_lbl('explosion_timer')
a.dec_r('a')
a.ld_lbl_a('explosion_timer')
a.or_r('a')
a.ret_cc('nz')
a.ld_a_lbl('lives')
a.or_r('a')
a.jp('z', 'start_game_over')
a.call('init_round')
a.ret()

a.label('start_game_over')
a.call('clear_fb')
a.call('draw_game_over_x')
a.ld_r_n('a', 120)
a.ld_lbl_a('game_over_timer')
a.ret()

a.label('tick_game_over')
a.ld_a_lbl('game_over_timer')
a.dec_r('a')
a.ld_lbl_a('game_over_timer')
a.or_r('a')
a.ret_cc('nz')
a.call('init_game')
a.ret()

a.label('rand8')
a.ld_a_lbl('rng')
a.rlca()
a.jp('nc', 'rand8_mix')
a.xor_n(0x1D)
a.label('rand8_mix')
a.add_a_n(37)
a.ld_lbl_a('rng')
a.ret()

a.label('is_pad_column')
a.cp_n(PAD1_START)
a.jp('c', 'is_pad_no')
a.cp_n(PAD1_END + 1)
a.jp('c', 'is_pad_yes')
a.cp_n(PAD2_START)
a.jp('c', 'is_pad_no')
a.cp_n(PAD2_END + 1)
a.jp('c', 'is_pad_yes')
a.label('is_pad_no')
a.xor_r('a')
a.ret()
a.label('is_pad_yes')
a.ld_r_n('a', 1)
a.ret()

a.label('get_ground_y')
a.push('de')
a.ld_r_r('e', 'a')
a.ld_r_n('d', 0)
a.ld_rp_label('hl', 'terrain')
a.add_hl_rp('de')
a.ld_r_hl('a')
a.ld_r_r('b', 'a')
a.ld_r_n('a', 64)
a.sub_r('b')
a.pop('de')
a.ret()

a.label('draw_game_over_x')
emit_game_over_x()
a.ret()

a.label('exit_to_cpm')
a.emit(0xC3, 0x00, 0x00)

# plot: pixel at D=x(0-63), E=y(0-63), color C. Clobbers A,HL. Preserves BC, DE.
a.label('plot')
a.push('bc')
a.push('de')
# bounds check
a.ld_r_r('a', 'd'); a.cp_n(64); a.jp('nc', 'pl_out')
a.ld_r_r('a', 'e'); a.cp_n(64); a.jp('nc', 'pl_out')
# HL = FB_BASE
a.ld_rp_nn('hl', 0x2000)
# right half? +512
a.ld_r_r('a', 'd'); a.and_n(0x20); a.jr('z', 'pl_lx')
a.push('bc'); a.ld_rp_nn('bc', 512); a.add_hl_rp('bc'); a.pop('bc')
a.label('pl_lx')
# bottom half? +1024
a.ld_r_r('a', 'e'); a.and_n(0x20); a.jr('z', 'pl_ly')
a.push('bc'); a.ld_rp_nn('bc', 1024); a.add_hl_rp('bc'); a.pop('bc')
a.label('pl_ly')
# local coords
a.ld_r_r('a', 'd'); a.and_n(0x1F); a.ld_r_r('d', 'a')
a.ld_r_r('a', 'e'); a.and_n(0x1F)
# row offset = local_y * 16
a.push('de'); a.ld_r_r('e', 'a'); a.ld_r_n('d', 0)
a.sla('e'); a.rl('d'); a.sla('e'); a.rl('d')
a.sla('e'); a.rl('d'); a.sla('e'); a.rl('d')
a.add_hl_rp('de'); a.pop('de')
# col offset = local_x / 2
a.ld_r_r('a', 'd'); a.srl('a')
a.push('de'); a.ld_r_r('e', 'a'); a.ld_r_n('d', 0)
a.add_hl_rp('de'); a.pop('de')
# even x = low nibble, odd x = high nibble
a.ld_r_r('a', 'd'); a.and_n(1); a.jr('nz', 'pl_hi')
a.ld_r_r('a', '(hl)'); a.and_n(0xF0); a.or_r('c'); a.ld_r_r('(hl)', 'a')
a.jr('pl_out')
a.label('pl_hi')
a.ld_r_r('a', 'c')
a.sla('a'); a.sla('a'); a.sla('a'); a.sla('a')
a.ld_r_r('b', 'a')
a.ld_r_r('a', '(hl)'); a.and_n(0x0F); a.or_r('b'); a.ld_r_r('(hl)', 'a')
a.label('pl_out')
a.pop('de'); a.pop('bc'); a.ret()

a.label('hline')
a.push('bc')
a.push('de')
a.label('hl_lp')
a.call('plot')
a.inc_r('d')
a.djnz('hl_lp')
a.pop('de')
a.pop('bc')
a.ret()

a.label('vsync')
a.label('vs1')
a.in_a(DAZ_NX)
a.and_n(0x40)
a.jr('nz', 'vs1')
a.label('vs2')
a.in_a(DAZ_NX)
a.and_n(0x40)
a.jr('z', 'vs2')
a.ret()

a.label('clear_fb')
a.ld_rp_nn('hl', FB_BASE)
a.ld_rp_nn('de', FB_BASE + 1)
a.ld_rp_nn('bc', FB_SIZE - 1)
a.ld_r_n('(hl)', 0)
a.ldir()
a.ret()

# ─── Variables / data ──────────────────────────────────────────────────────────
for name in [
    'lander_x', 'lander_y', 'vx', 'vy', 'move_ctr', 'hm_ctr', 'grav_ctr',
    'thrust_req', 'flame_on', 'fuel', 'score', 'lives', 'success_timer',
    'explosion_timer', 'game_over_timer', 'frame_ctr', 'boom_x', 'boom_y', 'rng'
]:
    a.label(name)
    a.db(0)

a.label('terrain')
a.db(*TERRAIN)

# ─── Save ──────────────────────────────────────────────────────────────────────
a.resolve()
size = len(a.code)
if size >= 8192:
    raise SystemExit(f"LANDER.COM too large: {size} bytes")

outputs = [
    os.path.join(os.path.dirname(__file__), '..', 'web', 'public', 'LANDER.COM'),
    os.path.join(os.path.dirname(__file__), '..', 'games', 'LANDER.COM'),
]
for path in outputs:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(a.code)
    print(f"Written {size} bytes → {path}")
