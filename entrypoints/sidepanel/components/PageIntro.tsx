import { useId, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface PageIntroProps {
  title: string;
  description: string;
  meta?: string;
  actions?: ReactNode;
}

export default function PageIntro({ title, description, meta, actions }: PageIntroProps) {
  const titleId = useId();

  return (
    <section className="ds-page-intro" data-workbench-header="true" aria-labelledby={titleId}>
      <div className="ds-page-intro-content">
        <div className="ds-page-intro-copy">
          <div className="ds-page-intro-title-row">
            <h2 id={titleId} className="ds-page-intro-title">{title}</h2>
            {meta && (
              <Badge variant="outline" className="ds-page-intro-meta">
                {meta}
              </Badge>
            )}
          </div>
          <p className="ds-page-intro-description">{description}</p>
        </div>
        {actions && <div className="ds-page-intro-actions">{actions}</div>}
      </div>
      <Separator className="ds-page-intro-separator" />
    </section>
  );
}
