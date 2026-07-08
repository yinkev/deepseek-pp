import { useId, useMemo, useRef, useState } from 'react';
import type {
  GitHubSkillImportResult,
  GitHubSkillPreview,
  GitHubSkillPreviewItem,
} from '../../../core/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { requestGitHubApiPermission } from '../github-permission';
import { useI18n } from '../i18n';
import { TextField } from './settings/primitives';

type ImportState = 'idle' | 'previewing' | 'ready' | 'importing' | 'success' | 'error';

interface Props {
  onImported: () => Promise<void> | void;
  onCancel: () => void;
}

export default function GitHubSkillImportPanel({ onImported, onCancel }: Props) {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  const [state, setState] = useState<ImportState>('idle');
  const [preview, setPreview] = useState<GitHubSkillPreview | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<GitHubSkillImportResult | null>(null);
  const latestUrlRef = useRef('');
  const previewRequestIdRef = useRef(0);

  const selectedCount = selectedPaths.size;
  const allSelected = preview ? preview.skills.length > 0 && selectedCount === preview.skills.length : false;
  const canPreview = url.trim().length > 0 && state !== 'previewing' && state !== 'importing';
  const canImport = Boolean(preview) && selectedCount > 0 && state === 'ready';

  const selectedBytes = useMemo(() => {
    if (!preview) return 0;
    return preview.skills
      .filter((skill) => selectedPaths.has(skill.path))
      .reduce((sum, skill) => sum + (skill.bytes ?? skill.bodyBytes ?? 0), 0);
  }, [preview, selectedPaths]);

  const runPreview = async () => {
    const requestedUrl = url.trim();
    const requestId = previewRequestIdRef.current + 1;
    previewRequestIdRef.current = requestId;
    setState('previewing');
    setMessage('');
    setResult(null);
    try {
      const granted = await requestGitHubApiPermission();
      if (!granted) throw new Error(t('sidepanel.githubSkillImport.permissionError'));
      const response = await chrome.runtime.sendMessage({
        type: 'PREVIEW_GITHUB_SKILL_SOURCE',
        payload: { url: requestedUrl },
      });
      if (response?.ok === false) throw new Error(response.error ?? t('sidepanel.githubSkillImport.previewFailed'));
      if (requestId !== previewRequestIdRef.current || latestUrlRef.current.trim() !== requestedUrl) return;
      const nextPreview = response as GitHubSkillPreview;
      setPreview(nextPreview);
      setSelectedPaths(new Set(nextPreview.skills.map((skill) => skill.path)));
      setState('ready');
    } catch (error) {
      if (requestId !== previewRequestIdRef.current || latestUrlRef.current.trim() !== requestedUrl) return;
      setPreview(null);
      setSelectedPaths(new Set());
      setState('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const runImport = async () => {
    if (!preview || selectedPaths.size === 0) return;
    setState('importing');
    setMessage('');
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'IMPORT_GITHUB_SKILL_SOURCE',
        payload: {
          url: url.trim(),
          selectedPaths: [...selectedPaths],
        },
      });
      if (response?.ok === false) throw new Error(response.error ?? t('sidepanel.githubSkillImport.importFailed'));
      const importResult = response as GitHubSkillImportResult;
      setResult(importResult);
      setState('success');
      setMessage(t('sidepanel.githubSkillImport.importedMessage', { count: importResult.imported.length }));
      await onImported();
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const togglePath = (path: string) => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    if (!preview) return;
    setSelectedPaths(allSelected ? new Set() : new Set(preview.skills.map((skill) => skill.path)));
  };

  return (
    <section className="ds-command-import-panel">
      <div className="ds-command-import-header">
        <div className="ds-command-import-copy">
          <h3>
            {t('sidepanel.githubSkillImport.title')}
          </h3>
          <p>
            {t('sidepanel.githubSkillImport.description')}
          </p>
        </div>
        <Button
          type="button"
          onClick={onCancel}
          variant="outline"
          size="sm"
          className="ds-command-import-button"
        >
          {t('common.close')}
        </Button>
      </div>

      <div className="ds-command-import-controls">
        <TextField
          id="github-skill-import-url"
          label={t('sidepanel.githubSkillImport.urlLabel')}
          type="url"
          placeholder={t('sidepanel.githubSkillImport.urlPlaceholder')}
          value={url}
          fieldClassName="ds-command-field ds-command-import-field"
          inputClassName="ds-command-import-input"
          onChange={(nextUrl) => {
            setUrl(nextUrl);
            latestUrlRef.current = nextUrl;
            previewRequestIdRef.current += 1;
            setPreview(null);
            setSelectedPaths(new Set());
            setResult(null);
            setMessage('');
            if (state !== 'importing') setState('idle');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canPreview) void runPreview();
          }}
          trailing={(
            <Button
              type="button"
              onClick={() => { void runPreview(); }}
              disabled={!canPreview}
              variant="outline"
              size="sm"
              className="ds-command-import-button"
            >
              {state === 'previewing' && <Spinner />}
              {t('common.preview')}
            </Button>
          )}
        />

        <div className="ds-command-import-hints">
          <span>{t('sidepanel.githubSkillImport.hintRepository')}</span>
          <span>{t('sidepanel.githubSkillImport.hintFolder')}</span>
          <span>{t('sidepanel.githubSkillImport.hintCommandFile')}</span>
        </div>
      </div>

      {preview && (
        <div className="ds-command-import-preview">
          <SourceSummary preview={preview} />

          <div className="ds-command-selection-row">
            <Button
              type="button"
              onClick={toggleAll}
              variant="outline"
              size="sm"
            >
              {allSelected ? t('sidepanel.githubSkillImport.clearSelection') : t('sidepanel.githubSkillImport.selectAll')}
            </Button>
            <span>
              {t('sidepanel.githubSkillImport.selectedSummary', {
                selected: selectedCount,
                total: preview.skills.length,
                bytes: formatBytes(selectedBytes),
              })}
            </span>
          </div>

          <div className="ds-command-preview-list">
            {preview.skills.map((skill) => (
              <PreviewSkillRow
                key={skill.path}
                skill={skill}
                checked={selectedPaths.has(skill.path)}
                onToggle={() => togglePath(skill.path)}
              />
            ))}
          </div>

          <div className="ds-command-form-actions">
            <Button
              type="button"
              onClick={onCancel}
              variant="outline"
              size="sm"
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              onClick={runImport}
              disabled={!canImport}
              variant="default"
              size="sm"
              className="ds-command-import-button"
            >
              {state === 'importing' && <Spinner />}
              {t('sidepanel.githubSkillImport.importSelected')}
            </Button>
          </div>
        </div>
      )}

      {message && (
        <StatusMessage state={state} message={message} result={result} />
      )}
    </section>
  );
}

function SourceSummary({ preview }: { preview: GitHubSkillPreview }) {
  const { t } = useI18n();
  const { source } = preview;
  const warnings = [
    ...preview.warnings,
    ...preview.skills.flatMap((skill) => skill.warnings.map((warning) => `${skill.importName}: ${warning}`)),
  ];

  return (
    <div className="ds-command-summary">
      <div className="ds-command-summary-head">
        <div className="ds-command-summary-copy">
          <div className="ds-command-summary-title">
            {source.repository}
          </div>
          <div className="ds-command-summary-detail">
            {source.rootPath || t('sidepanel.githubSkillImport.repoRoot')} · {source.ref} · {shortSha(source.commitSha)}
          </div>
        </div>
        <Button
          asChild
          variant="outline"
          size="sm"
        >
          <a
            href={source.repoUrl}
            target="_blank"
            rel="noreferrer"
            title={t('sidepanel.githubSkillImport.openRepository')}
          >
            {t('sidepanel.githubSkillImport.openRepository')}
          </a>
        </Button>
      </div>
      <div className="ds-command-meta-grid">
        <Meta label={t('sidepanel.githubSkillImport.meta.license')} value={source.licenseSpdxId ?? source.licenseName ?? t('sidepanel.githubSkillImport.unknownLicense')} />
        <Meta label={t('sidepanel.githubSkillImport.meta.version')} value={source.packageVersion ?? '-'} />
        <Meta label={t('sidepanel.githubSkillImport.meta.skill')} value={String(preview.skills.length)} />
        <Meta label={t('sidepanel.githubSkillImport.meta.defaultBranch')} value={source.defaultBranch} />
      </div>
      {warnings.length > 0 && (
        <Alert className="ds-command-status-message" data-tone="warning" role="status" aria-live="polite">
          <AlertDescription>
            {warnings.slice(0, 4).map((warning) => (
              <div key={warning}>• {warning}</div>
            ))}
            {warnings.length > 4 && <div>• {t('sidepanel.githubSkillImport.warningOverflow', { count: warnings.length - 4 })}</div>}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function PreviewSkillRow({ skill, checked, onToggle }: {
  skill: GitHubSkillPreviewItem;
  checked: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const checkboxId = useId();

  return (
    <div className="ds-command-preview-row">
      <Checkbox
        id={checkboxId}
        checked={checked}
        onCheckedChange={() => onToggle()}
        aria-label={skill.importName}
        className="ds-command-preview-checkbox"
      />
      <label
        className="ds-command-preview-copy"
        htmlFor={checkboxId}
        onClick={(event) => {
          event.preventDefault();
          onToggle();
        }}
      >
        <div className="ds-command-preview-head">
          <code className="ds-trigger">/{skill.importName}</code>
          {skill.nameChanged && (
            <Badge variant="secondary" className="ds-command-preview-badge">
              {t('sidepanel.githubSkillImport.renamedBadge')}
            </Badge>
          )}
          {skill.version && (
            <Badge variant="outline" className="ds-command-preview-badge">
              v{skill.version}
            </Badge>
          )}
        </div>
        <p>{skill.description}</p>
        <div className="ds-command-preview-meta">
          <span>{skill.path}</span>
          <span>{formatBytes(skill.bodyBytes)}</span>
          <span>{t('sidepanel.githubSkillImport.resourceCount', { count: skill.includedFiles.length })}</span>
          {skill.omittedFiles.length > 0 && (
            <span>{t('sidepanel.githubSkillImport.omittedCount', { count: skill.omittedFiles.length })}</span>
          )}
        </div>
      </label>
    </div>
  );
}

function StatusMessage({ state, message, result }: {
  state: ImportState;
  message: string;
  result: GitHubSkillImportResult | null;
}) {
  const { t } = useI18n();
  const success = state === 'success';
  return (
    <Alert
      className="ds-command-status-message"
      data-tone={success ? 'neutral' : 'danger'}
      variant={success ? 'default' : 'destructive'}
      role={success ? 'status' : 'alert'}
      aria-live={success ? 'polite' : 'assertive'}
    >
      <AlertDescription>
        <div>{message}</div>
        {result && result.renamed > 0 && (
          <div>{t('sidepanel.githubSkillImport.renamedNotice', { count: result.renamed })}</div>
        )}
      </AlertDescription>
    </Alert>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="ds-command-meta">
      <div>{label}</div>
      <strong>{value}</strong>
    </div>
  );
}

function Spinner() {
  return <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
