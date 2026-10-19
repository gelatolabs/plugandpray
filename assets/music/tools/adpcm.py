"""PS1 SPU ADPCM ("VAG" blocks without the VAG header): 16 bytes per 28
samples. Byte 0: shift (low nibble) | filter << 4; byte 1: flags; then 14
bytes of 4-bit samples, low nibble first.

Flags: bit 0 loop end (jump to the loop address after this block), bit 1
repeat (0 with bit 0: stop, the voice goes silent), bit 2 loop start.

encode() picks the filter and shift for each block by trying them all (the
decoder's own rounding fed back, so errors don't build up), and starts the
loop with a filter-0 block (it doesn't depend on what came before, so the
first pass and every repeat decode it the same: no click at the loop).
"""
import numpy as np

FILTERS = np.array([(0, 0), (60, 0), (115, -52), (98, -55), (122, -60)], dtype=np.int64)
BLOCK = 28


def _encode_block(x, s1, s2, filters):
    """x: 28 int samples. Returns (best filter, shift, nibbles, decoded, s1, s2)."""
    best = None
    for f in filters:
        k0, k1 = FILTERS[f]
        # the shift the residual needs (from the original samples), and its neighbours
        prev = np.concatenate([[s2, s1], x[:-1]])
        res = x - ((prev[1:] * k0 + prev[:-1] * k1 + 32) >> 6)
        m = max(1, int(np.abs(res).max()))
        need = 12 - int(np.ceil(np.log2(max(m / 7, 1))))
        for shift in sorted({max(0, min(12, need + d)) for d in (-1, 0, 1)}):
            step = 1 << (12 - shift)
            p1, p2 = s1, s2
            nib = np.empty(BLOCK, dtype=np.int64)
            dec = np.empty(BLOCK, dtype=np.int64)
            err = 0
            for i in range(BLOCK):
                pred = (p1 * k0 + p2 * k1 + 32) >> 6
                q = int(round((int(x[i]) - pred) / step))
                q = -8 if q < -8 else 7 if q > 7 else q
                d = ((q << 12) >> shift) + pred
                d = -32768 if d < -32768 else 32767 if d > 32767 else d
                e = int(x[i]) - d
                err += e * e
                if best is not None and err >= best[0]:
                    break
                nib[i] = q
                dec[i] = d
                p2, p1 = p1, d
            else:
                if best is None or err < best[0]:
                    best = (err, f, shift, nib.copy(), dec.copy(), p1, p2)
    _, f, shift, nib, dec, p1, p2 = best
    return f, shift, nib, dec, p1, p2


def encode(samples, loop_start=None, loop_end=None):
    """samples: int16 array. With loop_start (a sample index, a multiple of 28)
    the sample loops from there to its end (its length must be a multiple of
    28); without, it plays once and stops. Returns (bytes, decoded int16)."""
    x = np.asarray(samples, dtype=np.int64)
    if loop_start is not None:
        assert loop_start % BLOCK == 0 and len(x) % BLOCK == 0, 'loops must be whole blocks'
    pad = (-len(x)) % BLOCK
    x = np.concatenate([x, np.zeros(pad, dtype=np.int64)])
    nblocks = len(x) // BLOCK
    out = bytearray()
    decoded = np.empty(len(x), dtype=np.int64)
    s1 = s2 = 0
    loop_block = None if loop_start is None else loop_start // BLOCK
    for b in range(nblocks):
        seg = x[b * BLOCK:(b + 1) * BLOCK]
        filters = [0] if b == loop_block else range(5)
        f, shift, nib, dec, s1, s2 = _encode_block(seg, s1, s2, filters)
        flags = 0
        if b == loop_block:
            flags |= 4
        if b == nblocks - 1:
            flags |= 3 if loop_block is not None else 1
        out.append(shift | (f << 4))
        out.append(flags)
        for i in range(0, BLOCK, 2):
            out.append((int(nib[i]) & 15) | ((int(nib[i + 1]) & 15) << 4))
        decoded[b * BLOCK:(b + 1) * BLOCK] = dec
    return bytes(out), decoded.astype(np.int16)


def decode(data, loops=0):
    """Decodes the blocks (following the loop `loops` more times), as the SPU would."""
    blocks = [data[i:i + 16] for i in range(0, len(data), 16)]
    out = []
    s1 = s2 = 0
    loop_at = 0
    i = 0
    left = loops
    while i < len(blocks):
        blk = blocks[i]
        shift, f, flags = blk[0] & 15, blk[0] >> 4, blk[1]
        k0, k1 = FILTERS[f]
        if flags & 4:
            loop_at = i
        for j in range(BLOCK):
            q = (blk[2 + j // 2] >> (4 * (j & 1))) & 15
            q = q - 16 if q >= 8 else q
            d = ((q << 12) >> shift) + ((s1 * k0 + s2 * k1 + 32) >> 6)
            d = max(-32768, min(32767, d))
            out.append(d)
            s2, s1 = s1, d
        if flags & 1:
            if flags & 2 and left > 0:
                left -= 1
                i = loop_at
                continue
            break
        i += 1
    return np.array(out, dtype=np.int16)
