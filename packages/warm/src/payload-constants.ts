export const U16_MAX: number = 0xffff;
export const U32_MAX: number = 0xffff_ffff;
export const U64_MAX: bigint = 0xffff_ffff_ffff_ffffn;
export const I64_MIN: bigint = -0x8000_0000_0000_0000n;
export const I64_MAX: bigint = 0x7fff_ffff_ffff_ffffn;
export const F32_MAX: number = 3.4028234663852886e38;
export const textEncoder: TextEncoder = new TextEncoder();
export const textDecoder: TextDecoder = new TextDecoder("utf-8", { fatal: true });
