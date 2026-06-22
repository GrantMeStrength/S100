#!/usr/bin/env python3
"""
FROGGER — A split-screen lane-crossing game for the Cromemco Dazzler + D+7A joystick.
Builds a CP/M .COM file (Z80 machine code, ORG 0x0100).
"""

import os, sys

# ─── Mini Z80 assembler (same as BREAKOUT) ─────────────────────────────────────

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
DARK_GREY = 8
BRIGHT_RED = RED | BRIGHT
BRIGHT_GREEN = GREEN | BRIGHT
BRIGHT_YELLOW = YELLOW | BRIGHT
BRIGHT_BLUE = BLUE | BRIGHT
BRIGHT_WHITE = WHITE | BRIGHT

SCREEN_ROAD = 0
SCREEN_RIVER = 1
FROG_START_X = 30
FROG_START_Y = 58
FROG_W = 4
FROG_H = 4
HOP_SIZE = 8
HOP_COOLDOWN = 6
HOME_Y = 6
HOME_W = 6
HOME_H = 6
HOME_XS = [6, 22, 38, 54]

ROAD_LANES = [
    dict(idx=1, y=48, w=6, color=RED,        bg=BLACK, dir='right', speed=5, xs=[0, 24, 48]),
    dict(idx=2, y=40, w=5, color=YELLOW,     bg=BLACK, dir='left',  speed=3, xs=[10, 32, 54]),
    dict(idx=3, y=32, w=8, color=MAGENTA,    bg=BLACK, dir='right', speed=5, xs=[4, 26, 48]),
    dict(idx=4, y=24, w=5, color=BRIGHT_RED, bg=BLACK, dir='left',  speed=2, xs=[8, 30, 52]),
]

RIVER_LANES = [
    dict(idx=5, y=48, w=12, color=YELLOW, bg=BLUE,  dir='right', speed=4, xs=[0, 24, 48]),
    dict(idx=6, y=40, w=8,  color=YELLOW, bg=BLUE,  dir='left',  speed=3, xs=[10, 30, 50]),
    dict(idx=7, y=32, w=10, color=YELLOW, bg=BLUE,  dir='right', speed=4, xs=[4, 26, 48]),
    dict(idx=8, y=24, w=6,  color=GREEN,  bg=BLUE,  dir='left',  speed=3, xs=[8, 30, 52]),
]

ALL_LANES = ROAD_LANES + RIVER_LANES

# ═══════════════════════════════════════════════════════════════════════════════

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


def rect_imm(x, y, w, h, color):
    for yy in range(y, y + h):
        hline_imm(x, yy, w, color)


def lane_x_label(idx, obj_idx):
    return f'lane{idx}_x{obj_idx}'


def lane_speed_label(idx):
    return f'lane{idx}_speed'


def lane_counter_label(idx):
    return f'lane{idx}_counter'


def lane_move_label(idx):
    return f'lane{idx}_move'


def home_label(idx):
    return f'home_{idx}'


def emit_draw_wrapped_rect(x_label, y, width, color, prefix):
    nowrap = f'{prefix}_nowrap'
    done = f'{prefix}_done'
    a.ld_a_lbl(x_label)
    a.cp_n(65 - width)
    a.jp('c', nowrap)

    a.ld_r_r('d', 'a')
    a.ld_r_n('e', y)
    a.ld_r_n('c', color)
    a.ld_r_n('a', 64)
    a.sub_r('d')
    a.ld_r_r('b', 'a')
    a.call('rect4')

    a.ld_r_n('d', 0)
    a.ld_r_n('e', y)
    a.ld_r_n('c', color)
    a.ld_a_lbl(x_label)
    a.add_a_n((width - 64) & 0xFF)
    a.ld_r_r('b', 'a')
    a.call('rect4')
    a.jp(done)

    a.label(nowrap)
    a.ld_a_lbl(x_label)
    a.ld_r_r('d', 'a')
    a.ld_r_n('e', y)
    a.ld_r_n('b', width)
    a.ld_r_n('c', color)
    a.call('rect4')

    a.label(done)


def emit_overlap_jump(x_label, width, hit_label, prefix):
    nowrap = f'{prefix}_nowrap'
    cont = f'{prefix}_cont'

    a.ld_a_lbl(x_label)
    a.cp_n(65 - width)
    a.jp('c', nowrap)

    a.ld_a_lbl(x_label)
    a.add_a_n((width - 64) & 0xFF)
    a.ld_r_r('b', 'a')
    a.ld_a_lbl('frog_x')
    a.cp_r('b')
    a.jp('c', hit_label)

    a.ld_a_lbl('frog_x')
    a.add_a_n(FROG_W - 1)
    a.ld_r_r('b', 'a')
    a.ld_a_lbl(x_label)
    a.cp_r('b')
    a.jp('c', hit_label)
    a.jp('z', hit_label)
    a.jp(cont)

    a.label(nowrap)
    a.ld_a_lbl('frog_x')
    a.add_a_n(FROG_W - 1)
    a.ld_r_r('b', 'a')
    a.ld_a_lbl(x_label)
    a.cp_r('b')
    a.jp('nc', cont)

    a.ld_a_lbl(x_label)
    a.add_a_n(width)
    a.ld_r_r('b', 'a')
    a.ld_a_lbl('frog_x')
    a.cp_r('b')
    a.jp('nc', cont)
    a.jp(hit_label)

    a.label(cont)


def emit_home_slot(x, filled=False):
    rect_imm(x, HOME_Y, HOME_W, HOME_H, GREEN)
    if filled:
        rect_imm(x + 1, HOME_Y + 1, HOME_W - 2, HOME_H - 2, BRIGHT_YELLOW)

# ─── Entry ─────────────────────────────────────────────────────────────────────

a.label('start')
a.di()
a.ld_rp_nn('sp', 0x1F00)
a.ld_r_n('a', 0x30)
a.out_a(DAZ_CC)
a.ld_r_n('a', 0x80 | FB_PAGE)
a.out_a(DAZ_NX)
a.call('init_game')

a.label('main_loop')
a.call('vsync')
a.call('erase_frog')
a.call('update_obstacles')
a.call('read_input')
a.call('handle_hop')
a.call('check_state')
a.call('draw_frog')
a.jp('main_loop')

# ═══════════════════════════════════════════════════════════════════════════════
#  SUBROUTINES
# ═══════════════════════════════════════════════════════════════════════════════

a.label('init_game')
a.ld_r_n('a', 3)
a.ld_lbl_a('lives')
a.ld_r_n('a', 1)
a.ld_lbl_a('level')
a.xor_r('a')
a.ld_lbl_a('score')
a.call('clear_homes')
a.call('init_lane_speeds')
a.jp('enter_road')

a.label('clear_homes')
a.xor_r('a')
for i in range(4):
    a.ld_lbl_a(home_label(i))
a.ld_lbl_a('homes_filled')
a.ret()

a.label('init_lane_speeds')
for lane in ALL_LANES:
    a.ld_r_n('a', lane['speed'])
    a.ld_lbl_a(lane_speed_label(lane['idx']))
a.ret()

a.label('reset_input_state')
a.xor_r('a')
a.ld_lbl_a('prev_joy_x')
a.ld_lbl_a('prev_joy_y')
a.ld_lbl_a('joy_xdir')
a.ld_lbl_a('joy_ydir')
a.ld_lbl_a('hop_cd')
a.ret()

a.label('reset_frog_bottom')
a.ld_r_n('a', FROG_START_X)
a.ld_lbl_a('frog_x')
a.ld_r_n('a', FROG_START_Y)
a.ld_lbl_a('frog_y')
a.call('reset_input_state')
a.ret()

a.label('reset_road_lanes')
for lane in ROAD_LANES:
    a.xor_r('a')
    a.ld_lbl_a(lane_counter_label(lane['idx']))
    a.ld_lbl_a(lane_move_label(lane['idx']))
    for obj_idx, xpos in enumerate(lane['xs']):
        a.ld_r_n('a', xpos)
        a.ld_lbl_a(lane_x_label(lane['idx'], obj_idx))
a.ret()

a.label('reset_river_lanes')
for lane in RIVER_LANES:
    a.xor_r('a')
    a.ld_lbl_a(lane_counter_label(lane['idx']))
    a.ld_lbl_a(lane_move_label(lane['idx']))
    for obj_idx, xpos in enumerate(lane['xs']):
        a.ld_r_n('a', xpos)
        a.ld_lbl_a(lane_x_label(lane['idx'], obj_idx))
a.ret()

a.label('enter_road')
a.xor_r('a')
a.ld_lbl_a('screen')
a.call('clear_fb')
a.call('draw_road_bg')
a.call('reset_frog_bottom')
a.call('reset_road_lanes')
a.call('draw_road_lanes')
a.call('draw_frog')
a.ret()

a.label('enter_river')
a.ld_r_n('a', 1)
a.ld_lbl_a('screen')
a.call('clear_fb')
a.call('draw_river_bg')
a.call('draw_homes')
a.call('reset_frog_bottom')
a.call('reset_river_lanes')
a.call('draw_river_lanes')
a.call('draw_frog')
a.ret()

a.label('draw_road_bg')
a.ld_r_n('e', 16)
a.ld_r_n('b', 8)
a.ld_r_n('c', GREEN)
a.call('fill_band')
a.ld_r_n('e', 56)
a.ld_r_n('b', 8)
a.ld_r_n('c', GREEN)
a.call('fill_band')
a.ret()

a.label('draw_river_bg')
a.ld_r_n('c', BLUE)
a.call('fill_screen')
a.ld_r_n('e', 4)
a.ld_r_n('b', 20)
a.ld_r_n('c', GREEN)
a.call('fill_band')
a.ld_r_n('e', 56)
a.ld_r_n('b', 8)
a.ld_r_n('c', GREEN)
a.call('fill_band')
a.ret()

a.label('draw_homes')
for i, x in enumerate(HOME_XS):
    filled_lbl = home_label(i)
    skip_fill = f'home_draw_skip_{i}'
    a.ld_r_n('d', x)
    a.ld_r_n('e', HOME_Y)
    a.ld_r_n('b', HOME_W)
    a.ld_r_n('c', GREEN)
    a.call('rect6')
    a.ld_a_lbl(filled_lbl)
    a.or_r('a')
    a.jp('z', skip_fill)
    a.ld_r_n('d', x + 1)
    a.ld_r_n('e', HOME_Y + 1)
    a.ld_r_n('b', HOME_W - 2)
    a.ld_r_n('c', BRIGHT_YELLOW)
    a.call('rect4')
    a.label(skip_fill)
a.ret()

a.label('draw_road_lanes')
for lane in ROAD_LANES:
    for obj_idx in range(3):
        emit_draw_wrapped_rect(lane_x_label(lane['idx'], obj_idx), lane['y'], lane['w'], lane['color'], f'drl_{lane["idx"]}_{obj_idx}')
a.ret()

a.label('draw_river_lanes')
for lane in RIVER_LANES:
    for obj_idx in range(3):
        emit_draw_wrapped_rect(lane_x_label(lane['idx'], obj_idx), lane['y'], lane['w'], lane['color'], f'dvl_{lane["idx"]}_{obj_idx}')
a.ret()

a.label('erase_frog')
a.ld_a_lbl('screen')
a.or_r('a')
a.jp('z', 'ef_road')
a.ld_a_lbl('frog_y')
a.cp_n(24)
a.jp('c', 'ef_green')
a.cp_n(56)
a.jp('nc', 'ef_green')
a.ld_r_n('c', BLUE)
a.jp('ef_draw')
a.label('ef_road')
a.ld_a_lbl('frog_y')
a.cp_n(24)
a.jp('c', 'ef_green')
a.cp_n(56)
a.jp('nc', 'ef_green')
a.ld_r_n('c', BLACK)
a.jp('ef_draw')
a.label('ef_green')
a.ld_r_n('c', GREEN)
a.label('ef_draw')
a.ld_a_lbl('frog_x')
a.ld_r_r('d', 'a')
a.ld_a_lbl('frog_y')
a.ld_r_r('e', 'a')
a.ld_r_n('b', FROG_W)
a.call('rect4')
a.ret()

a.label('draw_frog')
a.ld_a_lbl('frog_x')
a.ld_r_r('d', 'a')
a.ld_a_lbl('frog_y')
a.ld_r_r('e', 'a')
a.ld_r_n('b', FROG_W)
a.ld_r_n('c', BRIGHT_GREEN)
a.call('rect4')
a.ret()

a.label('read_input')
a.in_a(JOY_BTN)
a.ld_lbl_a('in_btn')
a.bit(0, 'a')
a.call('z', 'exit_to_cpm')
a.in_a(JOY_X)
a.ld_lbl_a('in_x')
a.in_a(JOY_Y)
a.ld_lbl_a('in_y')
a.ret()

a.label('handle_hop')
a.ld_a_lbl('hop_cd')
a.or_r('a')
a.jp('z', 'hh_cd_done')
a.dec_r('a')
a.ld_lbl_a('hop_cd')
a.label('hh_cd_done')

a.ld_a_lbl('in_x')
a.cp_n(128)
a.jp('nc', 'hh_x_left')
a.or_r('a')
a.jp('nz', 'hh_x_right')
a.xor_r('a')
a.ld_lbl_a('joy_xdir')
a.jp('hh_y_axis')
a.label('hh_x_left')
a.ld_r_n('a', 2)
a.ld_lbl_a('joy_xdir')
a.jp('hh_y_axis')
a.label('hh_x_right')
a.ld_r_n('a', 1)
a.ld_lbl_a('joy_xdir')

a.label('hh_y_axis')
a.ld_a_lbl('in_y')
a.cp_n(128)
a.jp('nc', 'hh_y_down')
a.or_r('a')
a.jp('nz', 'hh_y_up')
a.xor_r('a')
a.ld_lbl_a('joy_ydir')
a.jp('hh_try_x')
a.label('hh_y_down')
a.ld_r_n('a', 2)
a.ld_lbl_a('joy_ydir')
a.jp('hh_try_x')
a.label('hh_y_up')
a.ld_r_n('a', 1)
a.ld_lbl_a('joy_ydir')

a.label('hh_try_x')
a.ld_a_lbl('joy_xdir')
a.or_r('a')
a.jp('z', 'hh_try_y')
a.ld_a_lbl('prev_joy_x')
a.or_r('a')
a.jp('nz', 'hh_try_y')
a.ld_a_lbl('hop_cd')
a.or_r('a')
a.jp('nz', 'hh_store_prev')
a.ld_a_lbl('joy_xdir')
a.cp_n(1)
a.jp('z', 'hh_hop_right')
a.jp('hh_hop_left')

a.label('hh_try_y')
a.ld_a_lbl('joy_ydir')
a.or_r('a')
a.jp('z', 'hh_store_prev')
a.ld_a_lbl('prev_joy_y')
a.or_r('a')
a.jp('nz', 'hh_store_prev')
a.ld_a_lbl('hop_cd')
a.or_r('a')
a.jp('nz', 'hh_store_prev')
a.ld_a_lbl('joy_ydir')
a.cp_n(1)
a.jp('z', 'hh_hop_up')
a.jp('hh_hop_down')

a.label('hh_hop_left')
a.ld_a_lbl('frog_x')
a.cp_n(HOP_SIZE)
a.jp('c', 'hh_left_zero')
a.sub_n(HOP_SIZE)
a.jp('hh_left_store')
a.label('hh_left_zero')
a.xor_r('a')
a.label('hh_left_store')
a.ld_lbl_a('frog_x')
a.jp('hh_did_hop')

a.label('hh_hop_right')
a.ld_a_lbl('frog_x')
a.add_a_n(HOP_SIZE)
a.cp_n(61)
a.jp('c', 'hh_right_store')
a.ld_r_n('a', 60)
a.label('hh_right_store')
a.ld_lbl_a('frog_x')
a.jp('hh_did_hop')

a.label('hh_hop_up')
a.ld_a_lbl('frog_y')
a.cp_n(HOP_SIZE)
a.jp('c', 'hh_up_min')
a.sub_n(HOP_SIZE)
a.jp('hh_up_store')
a.label('hh_up_min')
a.ld_r_n('a', 2)
a.label('hh_up_store')
a.ld_lbl_a('frog_y')
a.jp('hh_did_hop')

a.label('hh_hop_down')
a.ld_a_lbl('frog_y')
a.add_a_n(HOP_SIZE)
a.cp_n(59)
a.jp('c', 'hh_down_store')
a.ld_r_n('a', 58)
a.label('hh_down_store')
a.ld_lbl_a('frog_y')

a.label('hh_did_hop')
a.ld_r_n('a', HOP_COOLDOWN)
a.ld_lbl_a('hop_cd')

a.label('hh_store_prev')
a.ld_a_lbl('joy_xdir')
a.ld_lbl_a('prev_joy_x')
a.ld_a_lbl('joy_ydir')
a.ld_lbl_a('prev_joy_y')
a.ret()

a.label('update_obstacles')
a.ld_a_lbl('screen')
a.or_r('a')
a.jp('z', 'uo_road')
a.jp('update_river_obstacles')
a.label('uo_road')
a.jp('update_road_obstacles')

a.label('update_road_obstacles')
for lane in ROAD_LANES:
    idx = lane['idx']
    for obj_idx in range(3):
        emit_draw_wrapped_rect(lane_x_label(idx, obj_idx), lane['y'], lane['w'], lane['bg'], f'ero_{idx}_{obj_idx}')
    do_move = f'uro_move_{idx}'
    done = f'uro_done_{idx}'
    a.xor_r('a')
    a.ld_lbl_a(lane_move_label(idx))
    a.ld_a_lbl(lane_counter_label(idx))
    a.inc_r('a')
    a.ld_lbl_a(lane_counter_label(idx))
    a.ld_r_r('b', 'a')
    a.ld_a_lbl(lane_speed_label(idx))
    a.cp_r('b')
    a.jp('z', do_move)
    a.jp(done)
    a.label(do_move)
    a.xor_r('a')
    a.ld_lbl_a(lane_counter_label(idx))
    a.ld_r_n('a', 1 if lane['dir'] == 'right' else 0xFF)
    a.ld_lbl_a(lane_move_label(idx))
    for obj_idx in range(3):
        xlbl = lane_x_label(idx, obj_idx)
        if lane['dir'] == 'right':
            wrap = f'uro_wrap_{idx}_{obj_idx}'
            cont = f'uro_cont_{idx}_{obj_idx}'
            a.ld_a_lbl(xlbl)
            a.inc_r('a')
            a.cp_n(64)
            a.jp('z', wrap)
            a.ld_lbl_a(xlbl)
            a.jp(cont)
            a.label(wrap)
            a.xor_r('a')
            a.ld_lbl_a(xlbl)
            a.label(cont)
        else:
            decit = f'uro_dec_{idx}_{obj_idx}'
            cont = f'uro_cont_{idx}_{obj_idx}'
            a.ld_a_lbl(xlbl)
            a.or_r('a')
            a.jp('nz', decit)
            a.ld_r_n('a', 63)
            a.ld_lbl_a(xlbl)
            a.jp(cont)
            a.label(decit)
            a.dec_r('a')
            a.ld_lbl_a(xlbl)
            a.label(cont)
    a.label(done)
    for obj_idx in range(3):
        emit_draw_wrapped_rect(lane_x_label(idx, obj_idx), lane['y'], lane['w'], lane['color'], f'dro_{idx}_{obj_idx}')
a.ret()

a.label('update_river_obstacles')
for lane in RIVER_LANES:
    idx = lane['idx']
    for obj_idx in range(3):
        emit_draw_wrapped_rect(lane_x_label(idx, obj_idx), lane['y'], lane['w'], lane['bg'], f'erv_{idx}_{obj_idx}')
    do_move = f'urv_move_{idx}'
    done = f'urv_done_{idx}'
    a.xor_r('a')
    a.ld_lbl_a(lane_move_label(idx))
    a.ld_a_lbl(lane_counter_label(idx))
    a.inc_r('a')
    a.ld_lbl_a(lane_counter_label(idx))
    a.ld_r_r('b', 'a')
    a.ld_a_lbl(lane_speed_label(idx))
    a.cp_r('b')
    a.jp('z', do_move)
    a.jp(done)
    a.label(do_move)
    a.xor_r('a')
    a.ld_lbl_a(lane_counter_label(idx))
    a.ld_r_n('a', 1 if lane['dir'] == 'right' else 0xFF)
    a.ld_lbl_a(lane_move_label(idx))
    for obj_idx in range(3):
        xlbl = lane_x_label(idx, obj_idx)
        if lane['dir'] == 'right':
            wrap = f'urv_wrap_{idx}_{obj_idx}'
            cont = f'urv_cont_{idx}_{obj_idx}'
            a.ld_a_lbl(xlbl)
            a.inc_r('a')
            a.cp_n(64)
            a.jp('z', wrap)
            a.ld_lbl_a(xlbl)
            a.jp(cont)
            a.label(wrap)
            a.xor_r('a')
            a.ld_lbl_a(xlbl)
            a.label(cont)
        else:
            decit = f'urv_dec_{idx}_{obj_idx}'
            cont = f'urv_cont_{idx}_{obj_idx}'
            a.ld_a_lbl(xlbl)
            a.or_r('a')
            a.jp('nz', decit)
            a.ld_r_n('a', 63)
            a.ld_lbl_a(xlbl)
            a.jp(cont)
            a.label(decit)
            a.dec_r('a')
            a.ld_lbl_a(xlbl)
            a.label(cont)
    a.label(done)
    for obj_idx in range(3):
        emit_draw_wrapped_rect(lane_x_label(idx, obj_idx), lane['y'], lane['w'], lane['color'], f'drv_{idx}_{obj_idx}')
a.ret()

a.label('check_state')
a.ld_a_lbl('screen')
a.or_r('a')
a.jp('z', 'check_road_state')
a.jp('check_river_state')

a.label('check_road_state')
a.ld_a_lbl('frog_y')
a.cp_n(24)
a.jp('c', 'road_to_river')
a.cp_n(56)
a.ret_cc('nc')
for lane in ROAD_LANES:
    idx = lane['idx']
    next_lane = f'cr_next_{idx}'
    hit = f'cr_hit_{idx}'
    a.ld_a_lbl('frog_y')
    a.cp_n(lane['y'])
    a.jp('c', next_lane)
    a.cp_n(lane['y'] + 8)
    a.jp('nc', next_lane)
    for obj_idx in range(3):
        emit_overlap_jump(lane_x_label(idx, obj_idx), lane['w'], hit, f'cr_{idx}_{obj_idx}')
    a.ret()
    a.label(hit)
    a.jp('lose_life')
    a.label(next_lane)
a.ret()

a.label('road_to_river')
a.jp('enter_river')

a.label('check_river_state')
a.ld_a_lbl('frog_y')
a.cp_n(56)
a.ret_cc('nc')
a.cp_n(24)
a.jp('c', 'river_top_zone')
for lane in RIVER_LANES:
    idx = lane['idx']
    next_lane = f'cv_next_{idx}'
    on_log = f'cv_onlog_{idx}'
    a.ld_a_lbl('frog_y')
    a.cp_n(lane['y'])
    a.jp('c', next_lane)
    a.cp_n(lane['y'] + 8)
    a.jp('nc', next_lane)
    for obj_idx in range(3):
        emit_overlap_jump(lane_x_label(idx, obj_idx), lane['w'], on_log, f'cv_{idx}_{obj_idx}')
    a.jp('lose_life')
    a.label(on_log)
    a.ld_a_lbl(lane_move_label(idx))
    a.or_r('a')
    a.ret_cc('z')
    if lane['dir'] == 'right':
        a.ld_a_lbl('frog_x')
        a.cp_n(60)
        a.jp('z', 'lose_life')
        a.inc_r('a')
        a.ld_lbl_a('frog_x')
        a.ret()
    else:
        a.ld_a_lbl('frog_x')
        a.or_r('a')
        a.jp('z', 'lose_life')
        a.dec_r('a')
        a.ld_lbl_a('frog_x')
        a.ret()
    a.label(next_lane)
a.jp('lose_life')

a.label('river_top_zone')
a.ld_a_lbl('frog_y')
a.cp_n(12)
a.jp('c', 'river_home_check')
a.ret()

a.label('river_home_check')
for i, x in enumerate(HOME_XS):
    next_slot = f'rh_next_{i}'
    try_slot = f'rh_try_{i}'
    filled = home_label(i)
    a.ld_a_lbl('frog_x')
    a.cp_n(x)
    a.jp('c', next_slot)
    a.cp_n(x + HOME_W)
    a.jp('c', try_slot)
    a.jp(next_slot)
    a.label(try_slot)
    a.ld_a_lbl(filled)
    a.or_r('a')
    a.jp('nz', 'lose_life')
    a.ld_r_n('a', 1)
    a.ld_lbl_a(filled)
    a.ld_a_lbl('homes_filled')
    a.inc_r('a')
    a.ld_lbl_a('homes_filled')
    a.ld_a_lbl('score')
    a.inc_r('a')
    a.ld_lbl_a('score')
    a.call('flash_success')
    a.ld_a_lbl('homes_filled')
    a.cp_n(4)
    a.call('z', 'next_level')
    a.jp('enter_road')
    a.label(next_slot)
a.jp('lose_life')

a.label('next_level')
a.ld_a_lbl('level')
a.inc_r('a')
a.ld_lbl_a('level')
a.call('clear_homes')
for lane in ALL_LANES:
    idx = lane['idx']
    skip = f'nl_skip_{idx}'
    a.ld_a_lbl(lane_speed_label(idx))
    a.cp_n(2)
    a.jp('c', skip)
    a.dec_r('a')
    a.ld_lbl_a(lane_speed_label(idx))
    a.label(skip)
a.ret()

a.label('flash_success')
a.ld_r_n('c', BRIGHT_GREEN)
a.ld_r_n('b', 4)
a.call('flash_color')
a.ret()

a.label('lose_life')
a.ld_r_n('c', BRIGHT_RED)
a.ld_r_n('b', 8)
a.call('flash_color')
a.ld_a_lbl('lives')
a.dec_r('a')
a.ld_lbl_a('lives')
a.or_r('a')
a.jp('z', 'game_over')
a.ld_a_lbl('screen')
a.or_r('a')
a.jp('z', 'enter_road')
a.jp('enter_river')

a.label('flash_color')
a.push('bc')
a.push('bc')
a.call('fill_screen')
a.pop('bc')
a.label('fc_wait')
a.call('vsync')
a.djnz('fc_wait')
a.pop('bc')
a.ret()

a.label('fill_screen')
a.push('bc')
a.push('de')
a.ld_r_n('e', 0)
a.label('fs_row')
a.ld_r_n('d', 0)
a.ld_r_n('b', 64)
a.call('hline')
a.inc_r('e')
a.ld_r_r('a', 'e')
a.cp_n(64)
a.jp('c', 'fs_row')
a.pop('de')
a.pop('bc')
a.ret()

a.label('fill_band')
a.push('bc')
a.push('de')
a.label('fb_row')
a.push('bc')
a.ld_r_n('d', 0)
a.ld_r_n('b', 64)
a.call('hline')
a.pop('bc')
a.inc_r('e')
a.djnz('fb_row')
a.pop('de')
a.pop('bc')
a.ret()

a.label('game_over')
a.call('clear_fb')
a.ld_r_n('c', BLACK)
a.call('fill_screen')
a.call('draw_game_over_x')
a.ld_r_n('b', 120)
a.label('go_wait')
a.call('vsync')
a.djnz('go_wait')
a.jp('init_game')

a.label('draw_game_over_x')
a.ld_r_n('b', 48)
a.ld_r_n('d', 8)
a.label('dgx_loop')
a.ld_r_r('e', 'd')
a.ld_r_n('c', BRIGHT_RED)
a.call('plot')
a.ld_r_r('e', 'd')
a.inc_r('e')
a.call('plot')
a.ld_r_r('e', 'd')
a.dec_r('e')
a.call('plot')
a.ld_r_n('a', 63)
a.sub_r('d')
a.ld_r_r('e', 'a')
a.ld_r_n('c', BRIGHT_RED)
a.call('plot')
a.ld_r_n('a', 63)
a.sub_r('d')
a.ld_r_r('e', 'a')
a.inc_r('e')
a.call('plot')
a.ld_r_n('a', 63)
a.sub_r('d')
a.ld_r_r('e', 'a')
a.dec_r('e')
a.call('plot')
a.inc_r('d')
a.djnz('dgx_loop')
a.ret()

a.label('exit_to_cpm')
a.emit(0xC3, 0x00, 0x00)

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

# plot: pixel at D=x(0-63), E=y(0-63), color C. Preserves BC, DE.
a.label('plot')
a.push('bc')
a.push('de')
a.ld_r_r('a', 'd'); a.cp_n(64); a.jp('nc', 'pl_out')
a.ld_r_r('a', 'e'); a.cp_n(64); a.jp('nc', 'pl_out')
a.ld_rp_nn('hl', 0x2000)
a.ld_r_r('a', 'd'); a.and_n(0x20); a.jr('z', 'pl_lx')
a.push('bc'); a.ld_rp_nn('bc', 512); a.add_hl_rp('bc'); a.pop('bc')
a.label('pl_lx')
a.ld_r_r('a', 'e'); a.and_n(0x20); a.jr('z', 'pl_ly')
a.push('bc'); a.ld_rp_nn('bc', 1024); a.add_hl_rp('bc'); a.pop('bc')
a.label('pl_ly')
a.ld_r_r('a', 'd'); a.and_n(0x1F); a.ld_r_r('d', 'a')
a.ld_r_r('a', 'e'); a.and_n(0x1F)
a.push('de'); a.ld_r_r('e', 'a'); a.ld_r_n('d', 0)
a.sla('e'); a.rl('d'); a.sla('e'); a.rl('d')
a.sla('e'); a.rl('d'); a.sla('e'); a.rl('d')
a.add_hl_rp('de'); a.pop('de')
a.ld_r_r('a', 'd'); a.srl('a')
a.push('de'); a.ld_r_r('e', 'a'); a.ld_r_n('d', 0)
a.add_hl_rp('de'); a.pop('de')
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

a.label('rect4')
a.push('bc')
a.push('de')
a.call('hline')
a.inc_r('e')
a.call('hline')
a.inc_r('e')
a.call('hline')
a.inc_r('e')
a.call('hline')
a.pop('de')
a.pop('bc')
a.ret()

a.label('rect6')
a.push('bc')
a.push('de')
a.call('hline')
a.inc_r('e')
a.call('hline')
a.inc_r('e')
a.call('hline')
a.inc_r('e')
a.call('hline')
a.inc_r('e')
a.call('hline')
a.inc_r('e')
a.call('hline')
a.pop('de')
a.pop('bc')
a.ret()

# ─── Data ──────────────────────────────────────────────────────────────────────
a.label('in_btn'); a.db(0xFF)
a.label('in_x'); a.db(0)
a.label('in_y'); a.db(0)
a.label('screen'); a.db(0)
a.label('frog_x'); a.db(FROG_START_X)
a.label('frog_y'); a.db(FROG_START_Y)
a.label('prev_joy_x'); a.db(0)
a.label('prev_joy_y'); a.db(0)
a.label('joy_xdir'); a.db(0)
a.label('joy_ydir'); a.db(0)
a.label('hop_cd'); a.db(0)
a.label('lives'); a.db(3)
a.label('level'); a.db(1)
a.label('score'); a.db(0)
a.label('homes_filled'); a.db(0)
for i in range(4):
    a.label(home_label(i)); a.db(0)
for lane in ALL_LANES:
    for obj_idx, xpos in enumerate(lane['xs']):
        a.label(lane_x_label(lane['idx'], obj_idx)); a.db(xpos)
    a.label(lane_speed_label(lane['idx'])); a.db(lane['speed'])
    a.label(lane_counter_label(lane['idx'])); a.db(0)
    a.label(lane_move_label(lane['idx'])); a.db(0)

# ─── Save ──────────────────────────────────────────────────────────────────────
out = os.path.join(os.path.dirname(__file__), '..', 'web', 'public', 'FROGGER.COM')
out2 = os.path.join(os.path.dirname(__file__), '..', 'games', 'FROGGER.COM')
os.makedirs(os.path.dirname(out), exist_ok=True)
os.makedirs(os.path.dirname(out2), exist_ok=True)
a.save(out)
a.save(out2)
