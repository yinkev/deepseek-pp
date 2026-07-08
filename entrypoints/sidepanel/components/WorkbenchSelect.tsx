import { Fragment, useId } from 'react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface WorkbenchSelectGroup<T extends string> {
  key: string;
  label?: string;
  items: Array<{ value: T; label: string }>;
}

interface WorkbenchSelectProps<T extends string> {
  label: string;
  value: T;
  groups: WorkbenchSelectGroup<T>[];
  onChange: (value: T) => void;
  className?: string;
}

export default function WorkbenchSelect<T extends string>({
  label,
  value,
  groups,
  onChange,
  className,
}: WorkbenchSelectProps<T>) {
  const labelId = useId();

  return (
    <div className={`ds-settings-picker${className ? ` ${className}` : ''}`}>
      <span id={labelId} className="ds-settings-picker-label">{label}</span>
      <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger
          aria-labelledby={labelId}
          className="ds-settings-select-trigger w-full"
          size="sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          className="ds-settings-select-content"
        >
          {groups.map((group, index) => (
            <Fragment key={group.key}>
              {index > 0 && <SelectSeparator />}
              <SelectGroup>
                {group.label && <SelectLabel>{group.label}</SelectLabel>}
                {group.items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </Fragment>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
