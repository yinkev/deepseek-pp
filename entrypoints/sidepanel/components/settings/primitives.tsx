import { useId, useRef, useState, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton as ShadcnSkeleton } from '@/components/ui/skeleton';
import { Slider as ShadcnSlider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useI18n } from '../../i18n';

/**
 * Shared building blocks for the settings sub-pages.
 *
 * These replace the hand-copied toggle/slider/section/status markup that was
 * duplicated across SettingsPage, PromptControlPanel and VoiceSettingsPanel so
 * every settings surface looks and behaves identically.
 */

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="ds-settings-section">
      <div className="ds-settings-section-header">
        <h2 className="ds-settings-section-title">{title}</h2>
        {description && (
          <p className="ds-settings-section-description">{description}</p>
        )}
      </div>
      <div className="ds-surface-panel ds-settings-section-panel">{children}</div>
    </section>
  );
}

export function ToggleRow({
  title,
  description,
  enabled,
  disabled,
  onToggle,
  trailing,
  disabledLabel,
}: {
  title: string;
  description?: string;
  enabled: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
  trailing?: ReactNode;
  disabledLabel?: string;
}) {
  const { t } = useI18n();
  const switchId = useId();
  const state = enabled ? 'on' : 'off';
  const stateLabel = state === 'on' ? t('common.on') : t('common.off');
  const availabilityLabel = disabled && disabledLabel ? disabledLabel : '';
  const ariaLabel = availabilityLabel ? `${title}: ${stateLabel}, ${availabilityLabel}` : `${title}: ${stateLabel}`;

  return (
    <Field
      orientation="horizontal"
      data-disabled={disabled ? true : undefined}
      className="ds-toggle-row"
    >
      <FieldContent className="ds-toggle-row-copy">
        <FieldLabel htmlFor={switchId} className="ds-toggle-row-title">
          {title}
        </FieldLabel>
        {description && (
          <FieldDescription className="ds-toggle-row-description">
            {description}
          </FieldDescription>
        )}
        {trailing}
      </FieldContent>
      <div className="ds-toggle-row-action">
        <span className="ds-toggle-row-state" data-state={state}>
          {stateLabel}
        </span>
        {availabilityLabel && (
          <span className="ds-toggle-row-state" data-state="unavailable">
            {availabilityLabel}
          </span>
        )}
        <Switch
          id={switchId}
          checked={enabled}
          onCheckedChange={(next) => {
            if (!disabled) onToggle(next);
          }}
          disabled={disabled}
          aria-label={ariaLabel}
          className="ds-switch"
        />
      </div>
    </Field>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  disabled,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const labelId = useId();
  const valueId = `${labelId}-value`;

  return (
    <Field
      data-disabled={disabled ? true : undefined}
      className="ds-settings-slider-field"
    >
      <span className="ds-settings-slider-header">
        <FieldLabel id={labelId} className="ds-settings-slider-label">
          {label}
        </FieldLabel>
        <span id={valueId} className="ds-settings-slider-value">
          {format ? format(value) : value}
        </span>
      </span>
      <ShadcnSlider
        aria-labelledby={labelId}
        aria-describedby={valueId}
        aria-valuetext={format ? format(value) : String(value)}
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(next) => {
          const nextValue = next[0];
          if (typeof nextValue === 'number') onChange(nextValue);
        }}
        className="ds-settings-slider"
      />
    </Field>
  );
}

export function TextField({
  id,
  label,
  hint,
  meta,
  type = 'text',
  value,
  placeholder,
  autoComplete,
  ariaLabel,
  disabled,
  fieldClassName,
  inputClassName,
  onChange,
  onKeyDown,
  trailing,
}: {
  id?: string;
  label?: string;
  hint?: string;
  meta?: ReactNode;
  type?: string;
  value: string;
  placeholder?: string;
  autoComplete?: string;
  ariaLabel?: string;
  disabled?: boolean;
  fieldClassName?: string;
  inputClassName?: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  trailing?: ReactNode;
}) {
  const generatedInputId = useId();
  const inputId = id ?? generatedInputId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const input = (
    <Input
      id={inputId}
      type={type}
      value={value}
      placeholder={placeholder}
      autoComplete={autoComplete}
      aria-label={ariaLabel}
      aria-describedby={hintId}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      className={['ds-input ds-settings-control-input', trailing ? 'flex-1' : '', inputClassName].filter(Boolean).join(' ')}
    />
  );
  return (
    <Field
      data-disabled={disabled ? true : undefined}
      className={['ds-settings-control-field', fieldClassName].filter(Boolean).join(' ')}
    >
      {(label || meta) && (
        <span className="ds-field-label-row">
          {label && (
            <FieldLabel htmlFor={inputId} className="ds-field-label-text">
              {label}
            </FieldLabel>
          )}
          {meta && (
            <span className="ds-field-label-meta">
              {meta}
            </span>
          )}
        </span>
      )}
      {trailing ? (
        <div className="ds-settings-control-inline">{input}{trailing}</div>
      ) : (
        input
      )}
      {hint && (
        <FieldDescription id={hintId} className="ds-settings-control-description">
          {hint}
        </FieldDescription>
      )}
    </Field>
  );
}

export function TextAreaField({
  label,
  hint,
  meta,
  name,
  value,
  placeholder,
  rows = 4,
  fieldClassName,
  textareaClassName,
  onChange,
}: {
  label?: string;
  hint?: string;
  meta?: ReactNode;
  name?: string;
  value: string;
  placeholder?: string;
  rows?: number;
  fieldClassName?: string;
  textareaClassName?: string;
  onChange: (value: string) => void;
}) {
  const textareaId = useId();
  const hintId = hint ? `${textareaId}-hint` : undefined;

  return (
    <Field className={['ds-settings-control-field ds-library-textarea-field', fieldClassName].filter(Boolean).join(' ')}>
      {(label || meta) && (
        <span className="ds-field-label-row">
          {label && (
            <FieldLabel htmlFor={textareaId} className="ds-field-label-text">
              {label}
            </FieldLabel>
          )}
          {meta && (
            <span className="ds-field-label-meta">
              {meta}
            </span>
          )}
        </span>
      )}
      <Textarea
        id={textareaId}
        name={name}
        value={value}
        placeholder={placeholder}
        rows={rows}
        aria-describedby={hintId}
        onChange={(e) => onChange(e.target.value)}
        className={['ds-library-textarea', textareaClassName].filter(Boolean).join(' ')}
      />
      {hint && (
        <FieldDescription id={hintId} className="ds-settings-control-description">
          {hint}
        </FieldDescription>
      )}
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  hint,
  meta,
  value,
  options,
  disabled,
  onChange,
}: {
  label?: string;
  hint?: string;
  meta?: ReactNode;
  value: T;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const selectId = useId();
  const hintId = hint ? `${selectId}-hint` : undefined;

  return (
    <Field
      data-disabled={disabled ? true : undefined}
      className="ds-settings-control-field"
    >
      {(label || meta) && (
        <span className="ds-field-label-row">
          {label && (
            <FieldLabel htmlFor={selectId} className="ds-field-label-text">
              {label}
            </FieldLabel>
          )}
          {meta && (
            <span className="ds-field-label-meta">
              {meta}
            </span>
          )}
        </span>
      )}
      <NativeSelect
        id={selectId}
        value={value}
        disabled={disabled}
        aria-describedby={hintId}
        onChange={(e) => onChange(e.currentTarget.value as T)}
        className="ds-settings-native-select"
      >
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {hint && (
        <FieldDescription id={hintId} className="ds-settings-control-description">
          {hint}
        </FieldDescription>
      )}
    </Field>
  );
}

export function SettingsSegmentedGroup<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
}: {
  ariaLabel: string;
  options: Array<{ value: T; label: string }>;
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value ?? undefined}
      onValueChange={(next) => {
        if (next) onChange(next as T);
      }}
      className="ds-settings-segmented"
      data-count={options.length}
      aria-label={ariaLabel}
      size="sm"
      spacing={0}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            data-active={active ? 'true' : 'false'}
            className="ds-settings-segmented-option"
          >
            {option.label}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

export function StatusMessage({
  tone,
  children,
  onDismiss,
}: {
  tone: 'success' | 'error' | 'warning' | 'info';
  children: ReactNode;
  onDismiss?: () => void;
}) {
  const palette = {
    success: { color: 'var(--ds-text-secondary)', bg: 'var(--ds-surface)' },
    error: { color: 'var(--ds-danger)', bg: 'var(--ds-danger-bg)' },
    warning: { color: 'var(--ds-warning, var(--ds-text-secondary))', bg: 'var(--ds-warning-bg, var(--ds-surface))' },
    info: { color: 'var(--ds-text-secondary)', bg: 'var(--ds-surface)' },
  }[tone];
  return (
    <Alert
      variant={tone === 'error' ? 'destructive' : 'default'}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
      className="grid-cols-[minmax(0,1fr)_auto] items-start gap-2 px-3 py-2"
      style={{ color: palette.color, background: palette.bg, border: '1px solid var(--ds-border)', borderRadius: 'var(--radius-ctrl)', fontSize: '11px' }}
    >
      <AlertDescription className="min-w-0 text-[11px] leading-snug text-inherit">
        {children}
      </AlertDescription>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="dismiss"
          className="shrink-0 leading-none text-inherit opacity-60 hover:opacity-100"
          style={{ color: palette.color }}
        >
          ×
        </button>
      )}
    </Alert>
  );
}

/**
 * In-app confirm dialog that replaces window.confirm() so destructive actions
 * (overwrite local / overwrite remote / clear all) stay within the extension UI.
 *
 * The dialog reads the destructive tone and renders a danger-styled confirm
 * button; callers pass the message shown to the user and resolve the promise
 * with true/false. Only one confirm is expected on screen at a time, so the
 * component keeps its own open/closed state and exposes an imperative handle
 * via the returned `confirm` function.
 */
export function useConfirm() {
  const [state, setState] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    resolve: (ok: boolean) => void;
  } | null>(null);

  const confirm = (opts: {
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
  }) =>
    new Promise<boolean>((resolve) => {
      setState({ ...opts, resolve });
    });

  const node = state ? (
    <ConfirmDialog
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      onConfirm={() => {
        state.resolve(true);
        setState(null);
      }}
      onCancel={() => {
        state.resolve(false);
        setState(null);
      }}
    />
  ) : null;

  return { confirm, node };
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const resolvedRef = useRef(false);
  const cancel = () => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    onCancel();
  };
  const confirm = () => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    onConfirm();
  };

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <AlertDialogContent
        className="ds-modal-card"
        size="sm"
        onOverlayClick={cancel}
      >
        <AlertDialogHeader>
          <AlertDialogTitle id="ds-confirm-title" className="ds-modal-title">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="ds-modal-message">
            {message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="ds-modal-actions">
          <AlertDialogCancel type="button" size="sm" className="ds-btn-cancel px-3 py-2 text-[11px] font-medium" style={{ borderRadius: 'var(--radius-ctrl)' }} onClick={cancel}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction type="button" variant="destructive" size="sm" className="ds-btn-danger px-3 py-2 text-[11px] font-medium" style={{ borderRadius: 'var(--radius-ctrl)' }} onClick={confirm} autoFocus>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Compact route tab strip. The public API stays small so existing pages can
 * keep owning routing while shadcn/Radix owns tab semantics and keyboarding.
 */
export function SubTabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
}: {
  tabs: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
  ariaLabel: string;
}) {
  return (
    <nav className="sub-tabs" aria-label={ariaLabel}>
      <Tabs
        value={value}
        onValueChange={(next) => onChange(next as T)}
        className="sub-tabs-tabs"
      >
        <TabsList
          variant="line"
          aria-label={ariaLabel}
          className="sub-tabs-list"
        >
          {tabs.map((tab) => {
            const active = tab.key === value;
            return (
              <TabsTrigger
                key={tab.key}
                value={tab.key}
                className={`sub-tab${active ? ' sub-tab-active' : ''}`}
              >
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
    </nav>
  );
}

/**
 * Single-select chip group (radio semantics) for compact choices like memory
 * type filters, transport kinds, saved-item kind. Replaces the bespoke pill
 * rows that were duplicated across MemoryPage / MemoryForm / SavedPage / McpPage.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
}) {
  const padding = size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-[11px]';
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as T);
      }}
      className="ds-segmented"
      aria-label={ariaLabel}
      size="sm"
      spacing={2}
    >
      {options.map((option) => {
        const active = option.key === value;
        return (
          <ToggleGroupItem
            key={option.key}
            value={option.key}
            data-active={active ? 'true' : 'false'}
            className={`ds-segmented-option ${padding}`}
          >
            {option.label}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

/**
 * Unified empty state. Replaces `ds-empty-state` hand-usage, the bespoke
 * inline `text-[11px]` boxes in ProjectsPage, and ChatPage's `ds-chat-empty`.
 */
export function EmptyState({
  title,
  description,
  actions,
  icon,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Empty className="ds-empty-state">
      <EmptyMedia className="ds-empty-state-icon">
        {icon ?? (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0H4" />
          </svg>
        )}
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle className="ds-empty-state-title">{title}</EmptyTitle>
        {description && <EmptyDescription className="ds-empty-state-description">{description}</EmptyDescription>}
      </EmptyHeader>
      {actions && <EmptyContent className="flex flex-wrap gap-2 justify-center mt-1">{actions}</EmptyContent>}
    </Empty>
  );
}

/**
 * Loading skeleton bar. Used for first-paint placeholders on every page that
 * runs `load()` on mount, so the list area never flashes blank or shows a
 * false empty-state while data is in flight.
 */
export function Skeleton({ className = '', width }: { className?: string; width?: string }) {
  return (
    <ShadcnSkeleton
      className={`ds-skeleton rounded ${className}`}
      style={width ? { width } : undefined}
    />
  );
}

/** A vertical stack of skeleton rows for list placeholders. */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="ds-surface-panel p-3 space-y-2">
          <Skeleton className="h-3" width="60%" />
          <Skeleton className="h-2.5" width="85%" />
        </div>
      ))}
    </div>
  );
}

/** Metric cell — a labeled value tile. Promoted from 4 duplicated definitions. */
export function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2" style={{ background: 'var(--ds-bg)', border: '1px solid var(--ds-border)' }}>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--ds-text-tertiary)' }}>{label}</div>
      <div className="mt-0.5 truncate text-[12px] font-mono" style={{ color: 'var(--ds-text)' }}>{value}</div>
    </div>
  );
}

/** Small inline spinner. Promoted from 2 duplicated definitions + ad-hoc markup. */
export function Spinner({ className = 'w-3 h-3' }: { className?: string }) {
  return (
    <span
      className={`inline-block border-2 border-current border-t-transparent rounded-full animate-spin ${className}`}
      role="status"
      aria-label="loading"
    />
  );
}

/**
 * Banner state hook: a single transient message with tone + auto-dismiss.
 * Lifted from McpPage's `dismissTimer` pattern so every page can show a
 * success banner that fades after `dismissMs` while errors stay until cleared.
 */
export function useBanner(dismissMs = 4000) {
  const [banner, setBanner] = useState<{ tone: 'success' | 'error' | 'warning' | 'info'; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = (tone: 'success' | 'error' | 'warning' | 'info', text: string) => {
    if (timer.current) clearTimeout(timer.current);
    setBanner({ tone, text });
    if (tone === 'success') {
      timer.current = setTimeout(() => setBanner(null), dismissMs);
    }
  };
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    setBanner(null);
  };

  const node = banner ? (
    <StatusMessage tone={banner.tone} onDismiss={clear}>
      {banner.text}
    </StatusMessage>
  ) : null;

  return { banner, show, clear, node };
}
