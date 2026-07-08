import type { ReactElement, ReactNode } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface WorkbenchTooltipProps {
  label: ReactNode;
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

export default function WorkbenchTooltip({
  label,
  children,
  side = 'top',
  align = 'center',
}: WorkbenchTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} align={align} sideOffset={6} className="ds-workbench-tooltip">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
