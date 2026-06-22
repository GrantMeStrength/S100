#!/usr/bin/env python3
"""
ASTEROIDS — A simple Asteroids-style game for the Cromemco Dazzler + D+7A joystick.
Builds a CP/M .COM file (Z80 machine code, ORG 0x0100).

Display: 64×64 color, 2K normal mode (16 IBGR colors)
Framebuffer: 0x2000 (page 0x10), 2048 bytes
  4 quadrants of 512 bytes: TL, TR, BL, BR
  Each quadrant: 32×32 pixels, 16 bytes/row, 2 px/byte (low nib=left, high=right)

Joystick: Cromemco D+7A
  Port 0x18: buttons (active-LOW, bit0=exit, bit1=fire)
  Port 0x19: X-axis (0=center, 1-127=right, 128-255=left)
  Port 0x1A: Y-axis (0=center, 1-127=up, 128-255=down)
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
BRIGHT_CYAN = CYAN | BRIGHT
BRIGHT_WHITE = WHITE | BRIGHT

DIR_DX = [0, 1, 1, 1, 0, -1, -1, -1]
DIR_DY = [-1, -1, 0, 1, 1, 1, 0, -1]
BULLET_DX = [0, 2, 2, 2, 0, -2, -2, -2]
BULLET_DY = [-2, -2, 0, 2, 2, 2, 0, -2]

SHIP_OFF1_DX = [-1, -1, -1, 0, -1, 0, 1, 1]
SHIP_OFF1_DY = [1, 0, -1, -1, -1, -1, -1, 0]
SHIP_OFF2_DX = [1, 0, -1, -1, 1, 1, 1, 0]
SHIP_OFF2_DY = [1, 1, 1, 0, -1, 0, 1, 1]

AST_LARGE_POINTS = [
    (-1, -2), (0, -2), (1, -2),
    (-2, -1), (2, -1),
    (-2, 0), (2, 0),
    (-2, 1), (2, 1),
    (-1, 2), (0, 2), (1, 2),
]
AST_MED_POINTS = [
    (-1, -1), (0, -1), (1, -1),
    (-1, 0), (1, 0),
    (-1, 1), (0, 1), (1, 1),
]

INIT_ASTEROIDS = [
    (8, 8, 1, 1),
    (55, 8, -1, 1),
    (8, 55, 1, -1),
    (55, 55, -1, -1),
]

a = Z80()


def s8(v):
    return v & 0xFF


def bullet_lbl(i, field):
    return f'bullet{i}_{field}'


def ast_lbl(i, field):
    return f'ast{i}_{field}'


def store_imm(lbl, val):
    a.ld_r_n('a', val & 0xFF)
    a.ld_lbl_a(lbl)


def copy_lbl(src, dst):
    a.ld_a_lbl(src)
    a.ld_lbl_a(dst)


def load_coord_pair(x_lbl, y_lbl):
    a.ld_a_lbl(x_lbl)
    a.ld_r_r('d', 'a')
    a.ld_a_lbl(y_lbl)
    a.ld_r_r('e', 'a')


def emit_plot_from_de(dx, dy):
    a.push('de')
    a.ld_r_r('a', 'd')
    if dx:
        a.ld_r_n('b', s8(dx))
        a.call('add_wrap')
    a.ld_r_r('d', 'a')
    a.ld_r_r('a', 'e')
    if dy:
        a.ld_r_n('b', s8(dy))
        a.call('add_wrap')
    a.ld_r_r('e', 'a')
    a.call('plot')
    a.pop('de')


def emit_offsets_shape(points):
    for dx, dy in points:
        emit_plot_from_de(dx, dy)


def emit_ship_routine(name, x_lbl, y_lbl, dir_lbl, color):
    a.label(name)
    load_coord_pair(x_lbl, y_lbl)
    a.ld_r_n('c', color)
    a.call('plot')

    load_coord_pair(x_lbl, y_lbl)
    a.ld_a_lbl(dir_lbl)
    a.ld_rp_label('hl', 'ship_off1_dx_table')
    a.call('table_lookup_a')
    a.ld_r_n('b', 0)
    a.ld_r_r('b', 'a')
    a.ld_r_r('a', 'd')
    a.call('add_wrap')
    a.ld_r_r('d', 'a')
    a.ld_a_lbl(dir_lbl)
    a.ld_rp_label('hl', 'ship_off1_dy_table')
    a.call('table_lookup_a')
    a.ld_r_n('b', 0)
    a.ld_r_r('b', 'a')
    a.ld_r_r('a', 'e')
    a.call('add_wrap')
    a.ld_r_r('e', 'a')
    a.ld_r_n('c', color)
    a.call('plot')

    load_coord_pair(x_lbl, y_lbl)
    a.ld_a_lbl(dir_lbl)
    a.ld_rp_label('hl', 'ship_off2_dx_table')
    a.call('table_lookup_a')
    a.ld_r_n('b', 0)
    a.ld_r_r('b', 'a')
    a.ld_r_r('a', 'd')
    a.call('add_wrap')
    a.ld_r_r('d', 'a')
    a.ld_a_lbl(dir_lbl)
    a.ld_rp_label('hl', 'ship_off2_dy_table')
    a.call('table_lookup_a')
    a.ld_r_n('b', 0)
    a.ld_r_r('b', 'a')
    a.ld_r_r('a', 'e')
    a.call('add_wrap')
    a.ld_r_r('e', 'a')
    a.ld_r_n('c', color)
    a.call('plot')
    a.ret()


def emit_spawn_bullet(slot):
    done = f'spawn_bullet{slot}_done'
    store_imm(bullet_lbl(slot, 'active'), 1)
    store_imm(bullet_lbl(slot, 'life'), 16)
    copy_lbl('ship_x', bullet_lbl(slot, 'x'))
    copy_lbl('ship_y', bullet_lbl(slot, 'y'))
    copy_lbl('ship_x', bullet_lbl(slot, 'old_x'))
    copy_lbl('ship_y', bullet_lbl(slot, 'old_y'))
    a.ld_a_lbl('ship_dir')
    a.ld_rp_label('hl', 'bullet_dx_table')
    a.call('table_lookup_a')
    a.ld_lbl_a(bullet_lbl(slot, 'dx'))
    a.ld_a_lbl('ship_dir')
    a.ld_rp_label('hl', 'bullet_dy_table')
    a.call('table_lookup_a')
    a.ld_lbl_a(bullet_lbl(slot, 'dy'))
    a.jp(done)
    a.label(done)


def emit_asteroid_hit_check(point_x_reg, point_y_reg, slot, miss_label):
    a.ld_a_lbl(ast_lbl(slot, 'active'))
    a.or_r('a')
    a.jp('z', miss_label)
    a.ld_a_lbl(ast_lbl(slot, 'size'))
    a.inc_r('a')
    a.ld_r_r('c', 'a')
    a.ld_a_lbl(ast_lbl(slot, 'x'))
    a.ld_r_r('b', 'a')
    a.ld_r_r('a', point_x_reg)
    a.call('absdiff_within')
    a.jp('nc', miss_label)
    a.ld_a_lbl(ast_lbl(slot, 'y'))
    a.ld_r_r('b', 'a')
    a.ld_r_r('a', point_y_reg)
    a.call('absdiff_within')
    a.jp('nc', miss_label)


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
a.call('erase_ship')
a.call('erase_bullets')
a.call('erase_asteroids')
a.call('read_input')
a.call('update_ship')
a.call('spawn_bullet_if_requested')
a.call('move_bullets')
a.call('move_asteroids')
a.call('check_bullet_collisions')
a.call('check_ship_collision')
a.call('check_wave_clear')
a.call('draw_asteroids')
a.call('draw_ship')
a.call('draw_bullets')
a.jp('main_loop')

# ─── Game setup ────────────────────────────────────────────────────────────────
a.label('init_game')
a.call('clear_fb')
store_imm('lives', 3)
store_imm('frame_counter', 0)
store_imm('fire_lock', 0)
store_imm('fire_request', 0)
a.call('clear_bullets')
a.call('reset_ship')
a.call('init_wave')
a.ret()

a.label('reset_ship')
store_imm('ship_x', 32)
store_imm('ship_y', 32)
store_imm('ship_old_x', 32)
store_imm('ship_old_y', 32)
store_imm('ship_dir', 0)
store_imm('ship_old_dir', 0)
store_imm('ship_vx', 0)
store_imm('ship_vy', 0)
a.ret()

a.label('clear_bullets')
for i in range(2):
    store_imm(bullet_lbl(i, 'active'), 0)
    store_imm(bullet_lbl(i, 'life'), 0)
    store_imm(bullet_lbl(i, 'x'), 0)
    store_imm(bullet_lbl(i, 'y'), 0)
    store_imm(bullet_lbl(i, 'old_x'), 0)
    store_imm(bullet_lbl(i, 'old_y'), 0)
a.ret()

a.label('init_wave')
for i in range(8):
    if i < len(INIT_ASTEROIDS):
        x, y, dx, dy = INIT_ASTEROIDS[i]
        store_imm(ast_lbl(i, 'active'), 1)
        store_imm(ast_lbl(i, 'x'), x)
        store_imm(ast_lbl(i, 'y'), y)
        store_imm(ast_lbl(i, 'old_x'), x)
        store_imm(ast_lbl(i, 'old_y'), y)
        store_imm(ast_lbl(i, 'dx'), s8(dx))
        store_imm(ast_lbl(i, 'dy'), s8(dy))
        store_imm(ast_lbl(i, 'size'), 2)
        store_imm(ast_lbl(i, 'timer'), 0)
    else:
        store_imm(ast_lbl(i, 'active'), 0)
        store_imm(ast_lbl(i, 'x'), 0)
        store_imm(ast_lbl(i, 'y'), 0)
        store_imm(ast_lbl(i, 'old_x'), 0)
        store_imm(ast_lbl(i, 'old_y'), 0)
        store_imm(ast_lbl(i, 'dx'), 0)
        store_imm(ast_lbl(i, 'dy'), 0)
        store_imm(ast_lbl(i, 'size'), 0)
        store_imm(ast_lbl(i, 'timer'), 0)
a.ret()

# ─── Input / ship ──────────────────────────────────────────────────────────────
a.label('read_input')
a.in_a(JOY_X)
a.ld_lbl_a('in_x')
a.in_a(JOY_Y)
a.ld_lbl_a('in_y')
a.in_a(JOY_BTN)
a.ld_lbl_a('in_btn')

a.ld_a_lbl('in_btn')
a.bit(0, 'a')
a.call('z', 'exit_to_cpm')

a.ld_a_lbl('in_btn')
a.bit(1, 'a')
a.jp('nz', 'ri_release')
a.ld_a_lbl('fire_lock')
a.or_r('a')
a.jp('nz', 'ri_done')
store_imm('fire_lock', 1)
store_imm('fire_request', 1)
a.jp('ri_done')

a.label('ri_release')
store_imm('fire_lock', 0)

a.label('ri_done')
a.ret()

a.label('update_ship')
a.ld_a_lbl('in_x')
a.or_r('a')
a.jp('z', 'us_thrust')
a.cp_n(128)
a.jp('nc', 'us_left')
a.ld_a_lbl('ship_dir')
a.inc_r('a')
a.and_n(7)
a.ld_lbl_a('ship_dir')
a.jp('us_thrust')

a.label('us_left')
a.ld_a_lbl('ship_dir')
a.dec_r('a')
a.and_n(7)
a.ld_lbl_a('ship_dir')

a.label('us_thrust')
a.ld_a_lbl('in_y')
a.or_r('a')
a.jp('z', 'us_frame')
a.cp_n(128)
a.jp('nc', 'us_frame')
a.ld_a_lbl('ship_dir')
a.ld_rp_label('hl', 'dir_dx_table')
a.call('table_lookup_a')
a.ld_r_r('b', 'a')
a.ld_rp_label('hl', 'ship_vx')
a.call('apply_thrust_component_hl')
a.ld_a_lbl('ship_dir')
a.ld_rp_label('hl', 'dir_dy_table')
a.call('table_lookup_a')
a.ld_r_r('b', 'a')
a.ld_rp_label('hl', 'ship_vy')
a.call('apply_thrust_component_hl')

a.label('us_frame')
a.ld_a_lbl('frame_counter')
a.inc_r('a')
a.ld_lbl_a('frame_counter')
a.and_n(3)
a.jp('nz', 'us_move')
a.ld_rp_label('hl', 'ship_vx')
a.call('apply_friction_hl')
a.ld_rp_label('hl', 'ship_vy')
a.call('apply_friction_hl')

a.label('us_move')
a.ld_a_lbl('ship_x')
a.ld_r_r('b', 'a')
a.ld_a_lbl('ship_vx')
a.ld_r_r('b', 'a')
a.ld_a_lbl('ship_x')
a.call('add_wrap')
a.ld_lbl_a('ship_x')
a.ld_a_lbl('ship_y')
a.ld_r_r('b', 'a')
a.ld_a_lbl('ship_vy')
a.ld_r_r('b', 'a')
a.ld_a_lbl('ship_y')
a.call('add_wrap')
a.ld_lbl_a('ship_y')
a.ret()

a.label('spawn_bullet_if_requested')
a.ld_a_lbl('fire_request')
a.or_r('a')
a.ret_cc('z')
store_imm('fire_request', 0)
for i in range(2):
    nxt = f'sbir_next_{i}'
    a.ld_a_lbl(bullet_lbl(i, 'active'))
    a.or_r('a')
    a.jp('nz', nxt)
    store_imm(bullet_lbl(i, 'active'), 1)
    store_imm(bullet_lbl(i, 'life'), 16)
    copy_lbl('ship_x', bullet_lbl(i, 'x'))
    copy_lbl('ship_y', bullet_lbl(i, 'y'))
    copy_lbl('ship_x', bullet_lbl(i, 'old_x'))
    copy_lbl('ship_y', bullet_lbl(i, 'old_y'))
    a.ld_a_lbl('ship_dir')
    a.ld_rp_label('hl', 'bullet_dx_table')
    a.call('table_lookup_a')
    a.ld_lbl_a(bullet_lbl(i, 'dx'))
    a.ld_a_lbl('ship_dir')
    a.ld_rp_label('hl', 'bullet_dy_table')
    a.call('table_lookup_a')
    a.ld_lbl_a(bullet_lbl(i, 'dy'))
    a.ret()
    a.label(nxt)
a.ret()

# ─── Bullets ───────────────────────────────────────────────────────────────────
a.label('erase_bullets')
for i in range(2):
    skip = f'eb_skip_{i}'
    a.ld_a_lbl(bullet_lbl(i, 'active'))
    a.or_r('a')
    a.jp('z', skip)
    load_coord_pair(bullet_lbl(i, 'old_x'), bullet_lbl(i, 'old_y'))
    a.ld_r_n('c', BLACK)
    a.call('plot')
    a.label(skip)
a.ret()

a.label('draw_bullets')
for i in range(2):
    skip = f'db_skip_{i}'
    a.ld_a_lbl(bullet_lbl(i, 'active'))
    a.or_r('a')
    a.jp('z', skip)
    load_coord_pair(bullet_lbl(i, 'x'), bullet_lbl(i, 'y'))
    a.ld_r_n('c', BRIGHT_CYAN)
    a.call('plot')
    copy_lbl(bullet_lbl(i, 'x'), bullet_lbl(i, 'old_x'))
    copy_lbl(bullet_lbl(i, 'y'), bullet_lbl(i, 'old_y'))
    a.label(skip)
a.ret()

a.label('move_bullets')
for i in range(2):
    skip = f'mb_skip_{i}'
    dead = f'mb_dead_{i}'
    a.ld_a_lbl(bullet_lbl(i, 'active'))
    a.or_r('a')
    a.jp('z', skip)
    a.ld_a_lbl(bullet_lbl(i, 'x'))
    a.ld_r_r('b', 'a')
    a.ld_a_lbl(bullet_lbl(i, 'dx'))
    a.ld_r_r('b', 'a')
    a.ld_a_lbl(bullet_lbl(i, 'x'))
    a.call('add_wrap')
    a.ld_lbl_a(bullet_lbl(i, 'x'))
    a.ld_a_lbl(bullet_lbl(i, 'y'))
    a.ld_r_r('b', 'a')
    a.ld_a_lbl(bullet_lbl(i, 'dy'))
    a.ld_r_r('b', 'a')
    a.ld_a_lbl(bullet_lbl(i, 'y'))
    a.call('add_wrap')
    a.ld_lbl_a(bullet_lbl(i, 'y'))
    a.ld_a_lbl(bullet_lbl(i, 'life'))
    a.dec_r('a')
    a.ld_lbl_a(bullet_lbl(i, 'life'))
    a.jp('z', dead)
    a.jp(skip)
    a.label(dead)
    store_imm(bullet_lbl(i, 'active'), 0)
    a.label(skip)
a.ret()

# ─── Asteroids ─────────────────────────────────────────────────────────────────
a.label('erase_asteroids')
for i in range(8):
    skip = f'ea_skip_{i}'
    a.ld_a_lbl(ast_lbl(i, 'active'))
    a.or_r('a')
    a.jp('z', skip)
    load_coord_pair(ast_lbl(i, 'old_x'), ast_lbl(i, 'old_y'))
    a.ld_a_lbl(ast_lbl(i, 'size'))
    a.ld_r_r('b', 'a')
    a.ld_r_n('c', BLACK)
    a.call('draw_asteroid_shape')
    a.label(skip)
a.ret()

a.label('draw_asteroids')
for i in range(8):
    skip = f'da_skip_{i}'
    color_done = f'da_color_done_{i}'
    a.ld_a_lbl(ast_lbl(i, 'active'))
    a.or_r('a')
    a.jp('z', skip)
    load_coord_pair(ast_lbl(i, 'x'), ast_lbl(i, 'y'))
    a.ld_a_lbl(ast_lbl(i, 'size'))
    a.ld_r_r('b', 'a')
    a.cp_n(2)
    a.jp('z', f'da_large_{i}')
    a.cp_n(1)
    a.jp('z', f'da_medium_{i}')
    a.ld_r_n('c', BRIGHT_CYAN)
    a.jp(color_done)
    a.label(f'da_medium_{i}')
    a.ld_r_n('c', CYAN)
    a.jp(color_done)
    a.label(f'da_large_{i}')
    a.ld_r_n('c', WHITE)
    a.label(color_done)
    a.call('draw_asteroid_shape')
    copy_lbl(ast_lbl(i, 'x'), ast_lbl(i, 'old_x'))
    copy_lbl(ast_lbl(i, 'y'), ast_lbl(i, 'old_y'))
    a.label(skip)
a.ret()

a.label('move_asteroids')
for i in range(8):
    skip = f'ma_skip_{i}'
    move = f'ma_move_{i}'
    a.ld_a_lbl(ast_lbl(i, 'active'))
    a.or_r('a')
    a.jp('z', skip)
    a.ld_a_lbl(ast_lbl(i, 'timer'))
    a.or_r('a')
    a.jp('z', move)
    a.dec_r('a')
    a.ld_lbl_a(ast_lbl(i, 'timer'))
    a.jp(skip)
    a.label(move)
    a.ld_a_lbl(ast_lbl(i, 'x'))
    a.ld_r_r('b', 'a')
    a.ld_a_lbl(ast_lbl(i, 'dx'))
    a.ld_r_r('b', 'a')
    a.ld_a_lbl(ast_lbl(i, 'x'))
    a.call('add_wrap')
    a.ld_lbl_a(ast_lbl(i, 'x'))
    a.ld_a_lbl(ast_lbl(i, 'y'))
    a.ld_r_r('b', 'a')
    a.ld_a_lbl(ast_lbl(i, 'dy'))
    a.ld_r_r('b', 'a')
    a.ld_a_lbl(ast_lbl(i, 'y'))
    a.call('add_wrap')
    a.ld_lbl_a(ast_lbl(i, 'y'))
    a.ld_a_lbl(ast_lbl(i, 'size'))
    a.inc_r('a')
    a.ld_lbl_a(ast_lbl(i, 'timer'))
    a.label(skip)
a.ret()

# ─── Collisions ────────────────────────────────────────────────────────────────
for bi in range(2):
    a.label(f'check_bullet{bi}_collision')
    a.ld_a_lbl(bullet_lbl(bi, 'active'))
    a.or_r('a')
    a.ret_cc('z')
    load_coord_pair(bullet_lbl(bi, 'x'), bullet_lbl(bi, 'y'))
    for ai in range(8):
        miss = f'cbc_{bi}_{ai}_miss'
        emit_asteroid_hit_check('d', 'e', ai, miss)
        store_imm(bullet_lbl(bi, 'active'), 0)
        a.call(f'split_ast_{ai}')
        a.ret()
        a.label(miss)
    a.ret()

a.label('check_bullet_collisions')
a.call('check_bullet0_collision')
a.call('check_bullet1_collision')
a.ret()

a.label('ship_collision_point')
for ai in range(8):
    miss = f'scp_{ai}_miss'
    emit_asteroid_hit_check('d', 'e', ai, miss)
    a.call('lose_life')
    a.ld_r_n('a', 1)
    a.ret()
    a.label(miss)
a.xor_r('a')
a.ret()

a.label('check_ship_collision')
load_coord_pair('ship_x', 'ship_y')
a.call('ship_collision_point')
a.or_r('a')
a.ret_cc('nz')

load_coord_pair('ship_x', 'ship_y')
a.ld_a_lbl('ship_dir')
a.ld_rp_label('hl', 'ship_off1_dx_table')
a.call('table_lookup_a')
a.ld_r_r('b', 'a')
a.ld_r_r('a', 'd')
a.call('add_wrap')
a.ld_r_r('d', 'a')
a.ld_a_lbl('ship_dir')
a.ld_rp_label('hl', 'ship_off1_dy_table')
a.call('table_lookup_a')
a.ld_r_r('b', 'a')
a.ld_r_r('a', 'e')
a.call('add_wrap')
a.ld_r_r('e', 'a')
a.call('ship_collision_point')
a.or_r('a')
a.ret_cc('nz')

load_coord_pair('ship_x', 'ship_y')
a.ld_a_lbl('ship_dir')
a.ld_rp_label('hl', 'ship_off2_dx_table')
a.call('table_lookup_a')
a.ld_r_r('b', 'a')
a.ld_r_r('a', 'd')
a.call('add_wrap')
a.ld_r_r('d', 'a')
a.ld_a_lbl('ship_dir')
a.ld_rp_label('hl', 'ship_off2_dy_table')
a.call('table_lookup_a')
a.ld_r_r('b', 'a')
a.ld_r_r('a', 'e')
a.call('add_wrap')
a.ld_r_r('e', 'a')
a.call('ship_collision_point')
a.ret()

a.label('check_wave_clear')
for i in range(8):
    ready = f'cwc_active_{i}'
    a.ld_a_lbl(ast_lbl(i, 'active'))
    a.or_r('a')
    a.jp('nz', ready)
a.call('init_wave')
a.ret()
for i in range(8):
    a.label(f'cwc_active_{i}')
a.ret()

# ─── Splitting / lives ─────────────────────────────────────────────────────────
a.label('spawn_free_asteroid')
for i in range(8):
    nxt = f'sfa_next_{i}'
    a.ld_a_lbl(ast_lbl(i, 'active'))
    a.or_r('a')
    a.jp('nz', nxt)
    store_imm(ast_lbl(i, 'active'), 1)
    copy_lbl('spawn_x', ast_lbl(i, 'x'))
    copy_lbl('spawn_y', ast_lbl(i, 'y'))
    copy_lbl('spawn_x', ast_lbl(i, 'old_x'))
    copy_lbl('spawn_y', ast_lbl(i, 'old_y'))
    copy_lbl('spawn_dx', ast_lbl(i, 'dx'))
    copy_lbl('spawn_dy', ast_lbl(i, 'dy'))
    copy_lbl('spawn_size', ast_lbl(i, 'size'))
    store_imm(ast_lbl(i, 'timer'), 0)
    a.ret()
    a.label(nxt)
a.ret()

for i in range(8):
    a.label(f'split_ast_{i}')
    a.ld_a_lbl(ast_lbl(i, 'size'))
    a.or_r('a')
    a.jp('z', f'split_small_{i}')
    a.cp_n(1)
    a.jp('z', f'split_medium_{i}')

    copy_lbl(ast_lbl(i, 'dx'), 'tmp_dx')
    copy_lbl(ast_lbl(i, 'dy'), 'tmp_dy')
    copy_lbl(ast_lbl(i, 'x'), 'spawn_x')
    copy_lbl(ast_lbl(i, 'y'), 'spawn_y')
    copy_lbl('tmp_dy', ast_lbl(i, 'dx'))
    copy_lbl('tmp_dx', ast_lbl(i, 'dy'))
    store_imm(ast_lbl(i, 'size'), 1)
    store_imm(ast_lbl(i, 'timer'), 0)
    a.ld_a_lbl('tmp_dy')
    a.call('flip_unit')
    a.ld_lbl_a('spawn_dx')
    a.ld_a_lbl('tmp_dx')
    a.call('flip_unit')
    a.ld_lbl_a('spawn_dy')
    store_imm('spawn_size', 1)
    a.call('spawn_free_asteroid')
    a.ret()

    a.label(f'split_medium_{i}')
    copy_lbl(ast_lbl(i, 'dx'), 'tmp_dx')
    copy_lbl(ast_lbl(i, 'dy'), 'tmp_dy')
    copy_lbl(ast_lbl(i, 'x'), 'spawn_x')
    copy_lbl(ast_lbl(i, 'y'), 'spawn_y')
    copy_lbl('tmp_dy', ast_lbl(i, 'dx'))
    copy_lbl('tmp_dx', ast_lbl(i, 'dy'))
    store_imm(ast_lbl(i, 'size'), 0)
    store_imm(ast_lbl(i, 'timer'), 0)
    a.ld_a_lbl('tmp_dy')
    a.call('flip_unit')
    a.ld_lbl_a('spawn_dx')
    a.ld_a_lbl('tmp_dx')
    a.call('flip_unit')
    a.ld_lbl_a('spawn_dy')
    store_imm('spawn_size', 0)
    a.call('spawn_free_asteroid')
    a.ret()

    a.label(f'split_small_{i}')
    store_imm(ast_lbl(i, 'active'), 0)
    a.ret()

a.label('lose_life')
a.ld_a_lbl('lives')
a.dec_r('a')
a.ld_lbl_a('lives')
a.or_r('a')
a.jp('z', 'game_over')
a.call('clear_fb')
a.call('clear_bullets')
a.call('reset_ship')
a.call('init_wave')
a.ret()

a.label('game_over')
a.call('clear_fb')
a.ld_r_n('b', 120)
a.label('go_wait')
a.call('vsync')
a.djnz('go_wait')
a.jp('exit_to_cpm')

# ─── Draw ship / asteroid helpers ──────────────────────────────────────────────
emit_ship_routine('erase_ship', 'ship_old_x', 'ship_old_y', 'ship_old_dir', BLACK)
emit_ship_routine('draw_ship', 'ship_x', 'ship_y', 'ship_dir', BRIGHT_WHITE)

a.label('draw_asteroid_shape')
a.ld_r_r('a', 'b')
a.or_r('a')
a.jp('z', 'draw_ast_small')
a.cp_n(1)
a.jp('z', 'draw_ast_medium')
a.jp('draw_ast_large')

a.label('draw_ast_small')
a.call('plot')
a.ret()

a.label('draw_ast_medium')
emit_offsets_shape(AST_MED_POINTS)
a.ret()

a.label('draw_ast_large')
emit_offsets_shape(AST_LARGE_POINTS)
a.ret()

# ─── Small utility routines ────────────────────────────────────────────────────
a.label('table_lookup_a')
a.ld_r_r('e', 'a')
a.ld_r_n('d', 0)
a.add_hl_rp('de')
a.ld_r_hl('a')
a.ret()

a.label('flip_unit')
a.or_r('a')
a.ret_cc('z')
a.cp_n(1)
a.jp('z', 'flip_to_neg')
a.ld_r_n('a', 1)
a.ret()
a.label('flip_to_neg')
a.ld_r_n('a', 0xFF)
a.ret()

a.label('absdiff_within')
a.sub_r('b')
a.jp('nc', 'adw_pos')
a.neg()
a.label('adw_pos')
a.cp_r('c')
a.ret()

a.label('apply_thrust_component_hl')
a.ld_r_r('a', 'b')
a.or_r('a')
a.ret_cc('z')
a.cp_n(128)
a.jp('nc', 'atc_neg')
a.ld_r_hl('a')
a.cp_n(3)
a.ret_cc('z')
a.inc_r('a')
a.ld_hl_r('a')
a.ret()
a.label('atc_neg')
a.ld_r_hl('a')
a.cp_n(0xFD)
a.ret_cc('z')
a.dec_r('a')
a.ld_hl_r('a')
a.ret()

a.label('apply_friction_hl')
a.ld_r_hl('a')
a.or_r('a')
a.ret_cc('z')
a.cp_n(128)
a.jp('nc', 'afh_neg')
a.dec_r('a')
a.ld_hl_r('a')
a.ret()
a.label('afh_neg')
a.inc_r('a')
a.ld_hl_r('a')
a.ret()

a.label('add_wrap')
a.ld_r_r('d', 'a')
a.ld_r_r('a', 'b')
a.or_r('a')
a.jp('z', 'aw_zero')
a.cp_n(128)
a.jp('nc', 'aw_neg')
a.ld_r_r('b', 'a')
a.ld_r_r('a', 'd')
a.label('aw_pos_loop')
a.cp_n(63)
a.jp('z', 'aw_pos_wrap')
a.inc_r('a')
a.djnz('aw_pos_loop')
a.ret()
a.label('aw_pos_wrap')
a.xor_r('a')
a.djnz('aw_pos_loop')
a.ret()
a.label('aw_neg')
a.neg()
a.ld_r_r('b', 'a')
a.ld_r_r('a', 'd')
a.label('aw_neg_loop')
a.or_r('a')
a.jp('z', 'aw_neg_wrap')
a.dec_r('a')
a.djnz('aw_neg_loop')
a.ret()
a.label('aw_neg_wrap')
a.ld_r_n('a', 63)
a.djnz('aw_neg_loop')
a.ret()
a.label('aw_zero')
a.ld_r_r('a', 'd')
a.ret()

a.label('exit_to_cpm')
a.emit(0xC3, 0x00, 0x00)

a.label('rand8')
a.ld_a_lbl('rng')
a.ld_r_r('b', 'a')
a.add_a_r('a')
a.add_a_r('a')
a.add_a_r('b')
a.add_a_n(3)
a.ld_lbl_a('rng')
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

# plot: pixel at D=x(0-63), E=y(0-63), color C. Clobbers A,HL
a.label('plot')
a.push('bc')
a.push('de')

a.ld_r_r('a', 'd')
a.cp_n(64)
a.jp('nc', 'pl_out')
a.ld_r_r('a', 'e')
a.cp_n(64)
a.jp('nc', 'pl_out')

a.ld_rp_nn('hl', FB_BASE)

a.ld_r_r('a', 'd')
a.and_n(0x20)
a.jr('z', 'pl_lx')
a.push('bc')
a.ld_rp_nn('bc', 512)
a.add_hl_rp('bc')
a.pop('bc')
a.label('pl_lx')

a.ld_r_r('a', 'e')
a.and_n(0x20)
a.jr('z', 'pl_ly')
a.push('bc')
a.ld_rp_nn('bc', 1024)
a.add_hl_rp('bc')
a.pop('bc')
a.label('pl_ly')

a.ld_r_r('a', 'd')
a.and_n(0x1F)
a.ld_r_r('d', 'a')
a.ld_r_r('a', 'e')
a.and_n(0x1F)

a.push('de')
a.ld_r_r('e', 'a')
a.ld_r_n('d', 0)
a.sla('e'); a.rl('d')
a.sla('e'); a.rl('d')
a.sla('e'); a.rl('d')
a.sla('e'); a.rl('d')
a.add_hl_rp('de')
a.pop('de')

a.ld_r_r('a', 'd')
a.srl('a')
a.push('de')
a.ld_r_r('e', 'a')
a.ld_r_n('d', 0)
a.add_hl_rp('de')
a.pop('de')

a.ld_r_r('a', 'd')
a.and_n(1)
a.jr('nz', 'pl_hi')

a.ld_r_r('a', '(hl)')
a.and_n(0xF0)
a.or_r('c')
a.ld_r_r('(hl)', 'a')
a.jr('pl_out')

a.label('pl_hi')
a.ld_r_r('a', 'c')
a.sla('a'); a.sla('a'); a.sla('a'); a.sla('a')
a.ld_r_r('b', 'a')
a.ld_r_r('a', '(hl)')
a.and_n(0x0F)
a.or_r('b')
a.ld_r_r('(hl)', 'a')

a.label('pl_out')
a.pop('de')
a.pop('bc')
a.ret()

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

# ─── Data ──────────────────────────────────────────────────────────────────────
a.label('in_x'); a.db(0)
a.label('in_y'); a.db(0)
a.label('in_btn'); a.db(0xFF)
a.label('fire_lock'); a.db(0)
a.label('fire_request'); a.db(0)
a.label('frame_counter'); a.db(0)
a.label('lives'); a.db(3)
a.label('rng'); a.db(0x5A)

a.label('ship_x'); a.db(32)
a.label('ship_y'); a.db(32)
a.label('ship_old_x'); a.db(32)
a.label('ship_old_y'); a.db(32)
a.label('ship_dir'); a.db(0)
a.label('ship_old_dir'); a.db(0)
a.label('ship_vx'); a.db(0)
a.label('ship_vy'); a.db(0)

for i in range(2):
    a.label(bullet_lbl(i, 'active')); a.db(0)
    a.label(bullet_lbl(i, 'x')); a.db(0)
    a.label(bullet_lbl(i, 'y')); a.db(0)
    a.label(bullet_lbl(i, 'dx')); a.db(0)
    a.label(bullet_lbl(i, 'dy')); a.db(0)
    a.label(bullet_lbl(i, 'life')); a.db(0)
    a.label(bullet_lbl(i, 'old_x')); a.db(0)
    a.label(bullet_lbl(i, 'old_y')); a.db(0)

for i in range(8):
    a.label(ast_lbl(i, 'active')); a.db(0)
    a.label(ast_lbl(i, 'x')); a.db(0)
    a.label(ast_lbl(i, 'y')); a.db(0)
    a.label(ast_lbl(i, 'dx')); a.db(0)
    a.label(ast_lbl(i, 'dy')); a.db(0)
    a.label(ast_lbl(i, 'size')); a.db(0)
    a.label(ast_lbl(i, 'timer')); a.db(0)
    a.label(ast_lbl(i, 'old_x')); a.db(0)
    a.label(ast_lbl(i, 'old_y')); a.db(0)

a.label('spawn_x'); a.db(0)
a.label('spawn_y'); a.db(0)
a.label('spawn_dx'); a.db(0)
a.label('spawn_dy'); a.db(0)
a.label('spawn_size'); a.db(0)
a.label('tmp_dx'); a.db(0)
a.label('tmp_dy'); a.db(0)

a.label('dir_dx_table')
for v in DIR_DX:
    a.db(s8(v))
a.label('dir_dy_table')
for v in DIR_DY:
    a.db(s8(v))
a.label('bullet_dx_table')
for v in BULLET_DX:
    a.db(s8(v))
a.label('bullet_dy_table')
for v in BULLET_DY:
    a.db(s8(v))
a.label('ship_off1_dx_table')
for v in SHIP_OFF1_DX:
    a.db(s8(v))
a.label('ship_off1_dy_table')
for v in SHIP_OFF1_DY:
    a.db(s8(v))
a.label('ship_off2_dx_table')
for v in SHIP_OFF2_DX:
    a.db(s8(v))
a.label('ship_off2_dy_table')
for v in SHIP_OFF2_DY:
    a.db(s8(v))

# ─── Save ──────────────────────────────────────────────────────────────────────
out = os.path.join(os.path.dirname(__file__), '..', 'web', 'public', 'ASTEROIDS.COM')
a.save(out)
out2 = os.path.join(os.path.dirname(__file__), '..', 'games', 'ASTEROIDS.COM')
a.save(out2)
