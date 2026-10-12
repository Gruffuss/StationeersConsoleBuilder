// A simulated device's starting value per LogicType family (builder-defined; the spec's §7, "Simulated devices", and the M3
// plan's Task 1): a slider over a plausible range for the measured families, a constant 0 for every other type.
type Start = { kind: 'slider'; v: number; min: number; max: number } | { kind: 'const'; v: number }
export function defaultSource(lt: string): Start {
  if (/^Pressure/.test(lt)) return { kind: 'slider', v: 101.3, min: 0, max: 200 }
  if (/^Temperature/.test(lt)) return { kind: 'slider', v: 293.15, min: 200, max: 400 }
  if (/^Ratio/.test(lt)) return { kind: 'slider', v: 0.2, min: 0, max: 1 }
  if (lt === 'Charge' || lt === 'Setting') return { kind: 'slider', v: 0.5, min: 0, max: 1 }
  if (/^Power/.test(lt)) return { kind: 'slider', v: 1000, min: 0, max: 10000 }
  return { kind: 'const', v: 0 }
}
