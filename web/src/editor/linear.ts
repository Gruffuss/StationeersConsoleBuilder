// Vector v0.11.118: float sRGB interpolates, fragments decode it, and opacity blends in linear light.
// The sRGB8 target encodes after each blend; texture reads decode it before the display pass.
export const decode = (c8: number) => { const s = c8 / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
export const encode = (l: number) => Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055))
/** One channel stored in sRGB8 and read back as linear light. */
export const store = (l: number) => decode(encode(Math.min(1, Math.max(0, l))))
/** What a console shows for an opaque flat sRGB channel. */
export const flat = (c8: number) => encode(store(decode(c8)))
/** A console without a background contributes no colour or alpha to captures. */
export const CLEAR = [0, 0, 0, 0] as const
