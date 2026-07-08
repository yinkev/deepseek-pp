import type { ReactNode } from 'react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

interface WorkbenchScrollRailProps {
  label: string;
  children: ReactNode;
  className?: string;
  rowClassName?: string;
}

export default function WorkbenchScrollRail({
  label,
  children,
  className,
  rowClassName,
}: WorkbenchScrollRailProps) {
  return (
    <ScrollArea
      aria-label={label}
      type="always"
      className={`ds-workbench-scroll-rail${className ? ` ${className}` : ''}`}
    >
      <div className={`ds-workbench-scroll-row${rowClassName ? ` ${rowClassName}` : ''}`}>
        {children}
      </div>
      <ScrollBar orientation="horizontal" className="ds-workbench-scrollbar" />
    </ScrollArea>
  );
}
