interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  'aria-label'?: string;
}

export default function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled = false,
  'aria-label': ariaLabel,
}: ToggleSwitchProps) {
  return (
    <label className="inline-flex items-center gap-2 shrink-0 cursor-pointer" style={{ color: 'var(--ds-text-secondary)' }}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel ?? label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative shrink-0 w-10 h-[22px] rounded-full transition-colors duration-200 disabled:opacity-50"
        style={{
          background: checked ? 'var(--ds-blue)' : 'var(--ds-border)',
        }}
      >
        <span
          className="ds-switch-thumb absolute top-[3px] left-[3px] w-4 h-4 rounded-full transition-transform duration-200"
          style={{
            transform: checked ? 'translateX(18px)' : 'translateX(0)',
          }}
        />
      </button>
      {label && <span className="text-[11px]">{label}</span>}
    </label>
  );
}