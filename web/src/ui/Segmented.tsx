import { useId } from 'react'

export function Segmented<T extends string>(p: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean; className?: string }) {
  const name = useId()
  return <div className={`seg ${p.className ?? ''}`} role="radiogroup" aria-label={p.label}>
    {p.options.map(option => <label key={option.value}><input type="radio" name={name} value={option.value} checked={p.value === option.value} disabled={p.disabled}
      onChange={() => p.onChange(option.value)} /><span>{option.label}</span></label>)}
  </div>
}
