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
  const toggle = () => {
    if (!disabled) onChange(!checked);
  };

  return (
    <div className="inline-flex items-center gap-2 shrink-0" style={{ color: 'var(--ds-text-secondary)' }}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel ?? label}
        disabled={disabled}
        onClick={toggle}
        className="relative shrink-0 w-10 h-8 rounded-lg transition-colors duration-200 disabled:opacity-50"
      >
        <span
          className="absolute left-1 top-1/2 h-[18px] w-8 -translate-y-1/2 rounded-full transition-colors duration-200"
          style={{ background: checked ? 'var(--ds-blue)' : 'var(--ds-border)' }}
        >
          <span
            className="ds-switch-thumb absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full transition-transform duration-200"
            style={{ transform: checked ? 'translateX(14px)' : 'translateX(0)' }}
          />
        </span>
      </button>
      {label && (
        <button
          type="button"
          disabled={disabled}
          onClick={toggle}
          className="text-[11px] text-left disabled:opacity-50"
          style={{ color: 'inherit' }}
        >
          {label}
        </button>
      )}
    </div>
  );
}
