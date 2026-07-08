import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export type LibraryStatusState = 'checking' | 'attention' | 'empty' | 'ready';

interface LibraryStatusRow {
  label: string;
  value: string;
}

interface LibraryStatusAction {
  label: string;
  ariaLabel?: string;
  onClick: () => void;
}

interface LibraryStatusCardProps {
  title: string;
  description: string;
  state: LibraryStatusState;
  badgeLabel: string;
  rows: LibraryStatusRow[];
  loading: boolean;
  action?: LibraryStatusAction;
}

export default function LibraryStatusCard({
  title,
  description,
  state,
  badgeLabel,
  rows,
  loading,
  action,
}: LibraryStatusCardProps) {
  const badgeVariant = state === 'attention'
    ? 'destructive'
    : state === 'empty'
      ? 'outline'
      : 'secondary';

  return (
    <Card
      size="sm"
      className="ds-library-status-card"
      data-state={state}
      aria-live="polite"
      aria-busy={loading ? true : undefined}
    >
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Badge variant={badgeVariant}>{badgeLabel}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="ds-library-status-skeleton" aria-hidden="true">
            <Skeleton className="ds-library-status-skeleton-line" />
            <Skeleton className="ds-library-status-skeleton-line" />
          </div>
        ) : (
          <div className="ds-library-status-rows">
            {rows.map((row) => (
              <div className="ds-library-status-row" key={row.label}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {action && !loading && (
        <CardFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ds-library-status-action"
            aria-label={action.ariaLabel}
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
