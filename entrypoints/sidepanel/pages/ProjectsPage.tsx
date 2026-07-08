import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type {
  CurrentDeepSeekConversation,
  Memory,
  NewMemory,
  ProjectContext,
  ProjectContextState,
  ProjectConversation,
} from '../../../core/types';
import { PROJECT_CONTEXT_SCHEMA_VERSION } from '../../../core/project';
import MemoryForm from '../components/MemoryForm';
import PageIntro from '../components/PageIntro';
import WorkbenchTooltip from '../components/WorkbenchTooltip';
import { EmptyState, SkeletonList, TextAreaField, TextField, useBanner, useConfirm } from '../components/settings/primitives';
import { MEMORY_TYPE_MAP, SVG_PATHS } from '../constants';
import { useI18n } from '../i18n';
import { getRuntimeErrorMessage, unwrapRuntimeResponse } from '../runtime-response';

const EMPTY_PROJECT_STATE: ProjectContextState = {
  schemaVersion: PROJECT_CONTEXT_SCHEMA_VERSION,
  projects: [],
  conversations: [],
  pendingProjectId: null,
};

interface ProjectsPageProps {
  initialProjectId?: string | null;
  initialProjectNavigationKey?: number;
}

export default function ProjectsPage({
  initialProjectId = null,
  initialProjectNavigationKey = 0,
}: ProjectsPageProps = {}) {
  const { t } = useI18n();
  const [state, setState] = useState<ProjectContextState>(EMPTY_PROJECT_STATE);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [editing, setEditing] = useState<ProjectContext | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editInstructions, setEditInstructions] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [showMemoryForm, setShowMemoryForm] = useState(false);
  const [showFullInstructions, setShowFullInstructions] = useState(false);
  const [instructionsOverflow, setInstructionsOverflow] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [currentConversation, setCurrentConversation] = useState<CurrentDeepSeekConversation | null>(null);
  const [appliedProjectNavigationKey, setAppliedProjectNavigationKey] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [memoryLoadError, setMemoryLoadError] = useState<string | null>(null);
  const instructionsBodyRef = useRef<HTMLDivElement | null>(null);
  const banner = useBanner();
  const { confirm, node: confirmNode } = useConfirm();

  useEffect(() => {
    void loadAll();
    void refreshCurrentConversation();
    const handler = (msg: { type?: string; state?: ProjectContextState; memories?: Memory[] }) => {
      if (msg.type === 'PROJECT_CONTEXT_UPDATED' && isProjectContextState(msg.state)) {
        applyState(msg.state);
        setLoadError(null);
        setLoading(false);
        banner.clear();
        return;
      }
      if (msg.type === 'STATE_UPDATED' && Array.isArray(msg.memories)) {
        setMemories(msg.memories);
        setMemoryLoadError(null);
        banner.clear();
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    window.addEventListener('focus', refreshCurrentConversation);
    return () => {
      chrome.runtime.onMessage.removeListener(handler);
      window.removeEventListener('focus', refreshCurrentConversation);
    };
  }, []);

  useEffect(() => {
    if (!initialProjectId) return;
    if (appliedProjectNavigationKey === initialProjectNavigationKey) return;
    if (!state.projects.some((project) => project.id === initialProjectId)) return;
    setSelectedProjectId(initialProjectId);
    setAppliedProjectNavigationKey(initialProjectNavigationKey);
  }, [appliedProjectNavigationKey, initialProjectId, initialProjectNavigationKey, state.projects]);

  const selectedProject = useMemo(
    () => state.projects.find((project) => project.id === selectedProjectId) ?? state.projects[0] ?? null,
    [selectedProjectId, state.projects],
  );
  const pendingProject = useMemo(
    () => state.projects.find((project) => project.id === state.pendingProjectId) ?? null,
    [state.pendingProjectId, state.projects],
  );
  const projectConversations = useMemo(
    () => selectedProject
      ? state.conversations
        .filter((conversation) => conversation.projectId === selectedProject.id)
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      : [],
    [selectedProject, state.conversations],
  );
  const projectMemories = useMemo(
    () => selectedProject
      ? memories.filter((memory) => memory.scope === 'project' && memory.projectId === selectedProject.id)
      : [],
    [memories, selectedProject],
  );
  const currentConversationProject = currentConversation
    ? state.conversations.find((item) => item.conversationId === currentConversation.conversationId) ?? null
    : null;
  const currentConversationBelongsToSelected = Boolean(
    selectedProject && currentConversationProject?.projectId === selectedProject.id,
  );
  const selectedProjectIsPending = Boolean(selectedProject && state.pendingProjectId === selectedProject.id);
  const nextConversationStatus = selectedProjectIsPending
    ? t('sidepanel.projectsPage.nextConversationAssigned')
    : pendingProject
      ? t('sidepanel.projectsPage.nextConversationAssignedElsewhere', { name: pendingProject.name })
      : t('sidepanel.projectsPage.nextConversationNotAssigned');
  const currentConversationStatus = currentConversation
    ? currentConversationBelongsToSelected
      ? t('sidepanel.projectsPage.currentConversationLinked')
      : currentConversationProject
        ? t('sidepanel.projectsPage.currentConversationLinkedElsewhere')
        : t('sidepanel.projectsPage.currentConversationReady')
    : t('sidepanel.projectsPage.noCurrentConversation');
  const instructionsNeedDisclosure = Boolean(
    selectedProject?.instructions.trim() && (
      instructionsOverflow
      || selectedProject.instructions.length > 160
      || selectedProject.instructions.split('\n').length > 3
    ),
  );
  const projectStatus = selectedProject
    ? createProjectStatus({
      project: selectedProject,
      hasInstructions: Boolean(selectedProject.instructions.trim()),
      currentConversation,
      currentConversationProject,
      currentConversationBelongsToSelected,
      selectedProjectIsPending,
      pendingProject,
      memoryCount: projectMemories.length,
      t,
    })
    : null;

  useEffect(() => {
    if (!selectedProject) {
      setEditing(null);
      setInstructionsOverflow(false);
      return;
    }
    syncProjectDraft(selectedProject);
    setShowProjectSettings(false);
    setShowMemoryForm(false);
    setShowFullInstructions(false);
    setInstructionsOverflow(false);
    setEditingMemory(null);
  }, [selectedProject?.id]);

  useEffect(() => {
    if (!selectedProject || showProjectSettings) return;
    syncProjectDraft(selectedProject);
  }, [selectedProject, showProjectSettings]);

  useLayoutEffect(() => {
    const element = instructionsBodyRef.current;
    if (!element || showFullInstructions) return undefined;

    const measure = () => {
      const hasVerticalOverflow = element.scrollHeight > element.clientHeight + 1;
      const hasHorizontalOverflow = element.scrollWidth > element.clientWidth + 1;
      setInstructionsOverflow(hasVerticalOverflow || hasHorizontalOverflow);
    };

    measure();
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(measure)
      : null;
    resizeObserver?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [selectedProject?.id, selectedProject?.instructions, showFullInstructions]);

  function syncProjectDraft(project: ProjectContext) {
    setEditing(project);
    setEditName(project.name);
    setEditDescription(project.description);
    setEditInstructions(project.instructions);
  }

  async function loadAll(preferredProjectId?: string | null) {
    if (loading || loadError) setLoading(true);
    const [projectStateResult, memoryListResult] = await Promise.allSettled([
      chrome.runtime.sendMessage({ type: 'GET_PROJECT_CONTEXT_STATE' }),
      chrome.runtime.sendMessage({ type: 'GET_MEMORIES' }),
    ]);
    try {
      if (projectStateResult.status === 'rejected') throw projectStateResult.reason;
      const next = unwrapProjectResponse<ProjectContextState>(
        projectStateResult.value,
        t('sidepanel.projectsPage.backendUnavailable'),
      );
      if (!isProjectContextState(next)) throw new Error(t('sidepanel.projectsPage.backendUnavailable'));
      applyState(next, preferredProjectId);
      setLoadError(null);
      banner.clear();

      if (memoryListResult.status === 'fulfilled' && Array.isArray(memoryListResult.value)) {
        setMemories(memoryListResult.value);
        setMemoryLoadError(null);
      } else {
        const error = memoryListResult.status === 'rejected'
          ? memoryListResult.reason
          : new Error(t('sidepanel.projectsPage.backendUnavailable'));
        const message = t('sidepanel.projectsPage.memoriesLoadFailed', { error: getRuntimeErrorMessage(error) });
        setMemories([]);
        setMemoryLoadError(message);
        banner.show('error', message);
      }
    } catch (error) {
      const message = t('sidepanel.projectsPage.loadFailed', { error: getRuntimeErrorMessage(error) });
      setLoadError(message);
      banner.show('error', message);
    } finally {
      setLoading(false);
    }
  }

  function applyState(next: ProjectContextState, preferredProjectId?: string | null) {
    setState(next);
    setSelectedProjectId((current) => {
      if (preferredProjectId && next.projects.some((project) => project.id === preferredProjectId)) return preferredProjectId;
      if (current && next.projects.some((project) => project.id === current)) return current;
      return next.projects[0]?.id ?? null;
    });
  }

  async function refreshCurrentConversation() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_DEEPSEEK_CONVERSATION' });
      if (response?.ok && response.conversation) {
        setCurrentConversation(response.conversation as CurrentDeepSeekConversation);
        return;
      }
      setCurrentConversation(null);
    } catch {
      setCurrentConversation(null);
    }
  }

  async function createProject() {
    if (!name.trim()) return;
    try {
      banner.clear();
      const response = await chrome.runtime.sendMessage({
        type: 'CREATE_PROJECT_CONTEXT',
        payload: {
          name,
          instructions,
          ...(projectDescription.trim() ? { description: projectDescription } : {}),
        },
      });
      const project = unwrapProjectResponse<ProjectContext>(
        response,
        t('sidepanel.projectsPage.backendUnavailable'),
      );
      setName('');
      setProjectDescription('');
      setInstructions('');
      setShowCreateForm(false);
      setSelectedProjectId(project.id);
      banner.show('success', t('sidepanel.projectsPage.projectCreated', { name: project.name }));
      await loadAll(project.id);
    } catch (error) {
      showProjectError(error);
    }
  }

  async function saveProject() {
    if (!editing || !editName.trim()) return;
    try {
      banner.clear();
      await runProjectMutation({
        type: 'UPDATE_PROJECT_CONTEXT',
        payload: {
          projectId: editing.id,
          patch: {
            name: editName,
            description: editDescription,
            instructions: editInstructions,
          },
        },
      });
      banner.show('success', t('common.saveChanges'));
      await loadAll();
    } catch (error) {
      showProjectError(error);
    }
  }

  async function deleteProject(project: ProjectContext) {
    const ok = await confirm({
      title: t('sidepanel.projectsPage.deleteConfirm', { name: project.name }),
      message: t('sidepanel.projectsPage.deleteConfirmMessage'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    try {
      await runProjectMutation({
        type: 'DELETE_PROJECT_CONTEXT',
        payload: { projectId: project.id },
      });
      await loadAll();
    } catch (error) {
      showProjectError(error);
    }
  }

  async function addCurrentConversation() {
    if (!selectedProject || !currentConversation) return;
    try {
      await runProjectMutation({
        type: 'ADD_CONVERSATION_TO_PROJECT',
        payload: {
          projectId: selectedProject.id,
          conversation: currentConversation,
        },
      });
      await loadAll();
    } catch (error) {
      showProjectError(error);
    }
  }

  async function removeConversation(conversation: ProjectConversation) {
    try {
      await runProjectMutation({
        type: 'REMOVE_CONVERSATION_FROM_PROJECT',
        payload: { conversationId: conversation.conversationId },
      });
      await loadAll();
    } catch (error) {
      showProjectError(error);
    }
  }

  async function setPending(projectId: string | null) {
    try {
      await runProjectMutation({
        type: 'SET_PENDING_PROJECT_CONTEXT',
        payload: { projectId },
      });
      await loadAll();
    } catch (error) {
      showProjectError(error);
    }
  }

  function applyProjectStatusAction() {
    if (!projectStatus || !selectedProject) return;
    if (projectStatus.action === 'editInstructions') {
      setShowProjectSettings(true);
      return;
    }
    if (projectStatus.action === 'linkCurrent') {
      void addCurrentConversation();
      return;
    }
    if (projectStatus.action === 'setNext') {
      void setPending(selectedProject.id);
    }
  }

  async function saveProjectMemory(memory: NewMemory) {
    if (!selectedProject) return;
    try {
      if (editingMemory?.id) {
        await runProjectMutation({
          type: 'UPDATE_MEMORY',
          payload: {
            ...editingMemory,
            ...memory,
            scope: 'project',
            projectId: selectedProject.id,
            updatedAt: Date.now(),
          },
        });
      } else {
        await runProjectMutation({
          type: 'SAVE_MEMORY',
          payload: {
            ...memory,
            scope: 'project',
            projectId: selectedProject.id,
          },
        });
      }
      setShowMemoryForm(false);
      setEditingMemory(null);
      await loadAll();
    } catch (error) {
      showProjectError(error);
    }
  }

  async function deleteMemory(id: number) {
    try {
      await runProjectMutation({ type: 'DELETE_MEMORY', payload: { id } });
      await loadAll();
    } catch (error) {
      showProjectError(error);
    }
  }

  async function toggleMemoryPin(memory: Memory) {
    try {
      await runProjectMutation({
        type: 'UPDATE_MEMORY',
        payload: { ...memory, pinned: !memory.pinned },
      });
      await loadAll();
    } catch (error) {
      showProjectError(error);
    }
  }

  function showProjectError(error: unknown) {
    banner.show('error', t('sidepanel.projectsPage.operationFailed', { error: getRuntimeErrorMessage(error) }));
  }

  async function runProjectMutation(message: unknown): Promise<void> {
    unwrapProjectResponse(
      await chrome.runtime.sendMessage(message),
      t('sidepanel.projectsPage.backendUnavailable'),
    );
  }

  return (
    <div className="ds-page ds-project-page">
      <PageIntro
        title={t('sidepanel.projectsPage.title')}
        description={t('sidepanel.projectsPage.description')}
        actions={(
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowCreateForm((visible) => !visible)}
            className="ds-btn-secondary ds-project-small-button"
            aria-expanded={showCreateForm}
            aria-controls="ds-project-create-panel"
          >
            {showCreateForm ? t('common.cancel') : t('sidepanel.projectsPage.createTitle')}
          </Button>
        )}
      />

      {showCreateForm && (
        <section
          id="ds-project-create-panel"
          className="ds-project-form-panel"
          aria-label={t('sidepanel.projectsPage.createTitle')}
        >
          <div className="ds-project-section-head">
            <h3>{t('sidepanel.projectsPage.createTitle')}</h3>
          </div>
          <div className="ds-project-form-stack">
            <TextField
              label={t('sidepanel.projectsPage.nameLabel')}
              value={name}
              onChange={setName}
              placeholder={t('sidepanel.projectsPage.namePlaceholder')}
            />
            <TextField
              label={t('sidepanel.projectsPage.descriptionLabel')}
              value={projectDescription}
              onChange={setProjectDescription}
              placeholder={t('sidepanel.projectsPage.descriptionPlaceholder')}
            />
            <TextAreaField
              label={t('sidepanel.projectsPage.instructionsTitle')}
              value={instructions}
              onChange={setInstructions}
              placeholder={t('sidepanel.projectsPage.instructionsPlaceholder')}
              rows={4}
            />
            <div className="ds-project-form-actions">
              <Button
                type="button"
                size="sm"
                onClick={createProject}
                disabled={!name.trim()}
                className="ds-btn-primary ds-project-submit"
              >
                {t('sidepanel.projectsPage.createProject')}
              </Button>
            </div>
          </div>
        </section>
      )}

      {banner.node}
      {confirmNode}

      {loading ? (
        <SkeletonList rows={3} />
      ) : loadError ? (
        <EmptyState
          title={t('sidepanel.projectsPage.loadFailedTitle')}
          description={loadError}
          icon={<FolderIcon />}
          actions={(
            <Button type="button" variant="outline" size="sm" className="ds-btn-secondary ds-project-small-button" onClick={() => void loadAll()}>
              {t('common.retry')}
            </Button>
          )}
        />
      ) : state.projects.length === 0 ? (
        <EmptyState
          title={t('sidepanel.projectsPage.empty')}
          description={t('sidepanel.projectsPage.emptyHelp')}
          icon={<FolderIcon />}
        />
      ) : (
        <div className="ds-project-layout">
          <section className="ds-project-picker" aria-label={t('sidepanel.projectsPage.listTitle')}>
            <div className="ds-project-picker-head">
              <span>{t('sidepanel.projectsPage.listTitle')}</span>
            </div>
            <div className="ds-project-list">
              {state.projects.map((project) => {
                const count = state.conversations.filter((conversation) => conversation.projectId === project.id).length;
                const selected = project.id === selectedProject?.id;
                return (
                  <Button
                    key={project.id}
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedProjectId(project.id)}
                    className={`ds-project-row${selected ? ' ds-project-row-active' : ''}`}
                    aria-current={selected ? 'true' : undefined}
                  >
                    <span className="ds-project-row-icon">
                      <FolderIcon />
                    </span>
                    <span className="ds-project-row-copy">
                      <span>{project.name}</span>
                      {count > 0 && (
                        <small>
                          {t('sidepanel.projectsPage.conversationCount', { count })}
                        </small>
                      )}
                    </span>
                  </Button>
                );
              })}
            </div>
          </section>

          {selectedProject && editing && (
            <section className="ds-project-detail" aria-label={selectedProject.name}>
              {projectStatus && (
                <section className={`ds-project-readiness ds-project-readiness-${projectStatus.tone}`}>
                  <div className="ds-project-readiness-head">
                    <h3>{t('sidepanel.projectsPage.projectStatusTitle')}</h3>
                    <Badge variant={projectStatus.tone === 'ready' ? 'secondary' : 'outline'} className={`ds-project-readiness-badge ds-project-readiness-badge-${projectStatus.tone}`}>
                      {projectStatus.status}
                    </Badge>
                  </div>
                  <p>{projectStatus.description}</p>
                  <div className="ds-project-status-list">
                    <ProjectStatusRow
                      label={t('sidepanel.projectsPage.projectStatusProject')}
                      value={projectStatus.project}
                    />
                    <ProjectStatusRow
                      label={t('sidepanel.projectsPage.projectStatusOpenChat')}
                      value={projectStatus.openChat}
                      tone={projectStatus.openChatTone}
                    />
                    <ProjectStatusRow
                      label={t('sidepanel.projectsPage.projectStatusNextChat')}
                      value={projectStatus.nextChat}
                      tone={projectStatus.nextChatTone}
                    />
                    <ProjectStatusRow
                      label={t('sidepanel.projectsPage.projectStatusMemory')}
                      value={projectStatus.memory}
                      tone={projectStatus.memoryTone}
                    />
                  </div>
                  {projectStatus.action && (
                    <div className="ds-project-readiness-actions">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="ds-btn-secondary ds-project-small-button"
                        onClick={applyProjectStatusAction}
                      >
                        {projectStatus.actionLabel}
                      </Button>
                    </div>
                  )}
                </section>
              )}
              <header className="ds-project-detail-header">
                <div className="ds-project-title-block">
                  <h3>{selectedProject.name}</h3>
                  <p className="ds-project-status-line">
                    <span>
                      {selectedProject.instructions.trim()
                        ? t('sidepanel.projectsPage.instructionsConfigured')
                        : t('sidepanel.projectsPage.noInstructions')}
                    </span>
                  </p>
                  {selectedProject.description && <p className="ds-project-description">{selectedProject.description}</p>}
                </div>
                <div className="ds-project-actions">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowProjectSettings((visible) => !visible)}
                    className="ds-btn-secondary ds-project-small-button"
                    aria-expanded={showProjectSettings}
                    aria-controls="ds-project-settings-panel"
                  >
                    {showProjectSettings ? t('common.close') : t('sidepanel.projectsPage.settingsAction')}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteProject(selectedProject)}
                    className="ds-btn-danger ds-project-small-button"
                  >
                    {t('sidepanel.projectsPage.deleteProject')}
                  </Button>
                </div>
              </header>

              {showProjectSettings && (
                <div
                  id="ds-project-settings-panel"
                  className="ds-project-edit-form"
                  aria-label={t('sidepanel.projectsPage.settingsAction')}
                >
                  <TextField
                    label={t('sidepanel.projectsPage.nameLabel')}
                    value={editName}
                    onChange={setEditName}
                    placeholder={t('sidepanel.projectsPage.namePlaceholder')}
                  />
                  <TextField
                    label={t('sidepanel.projectsPage.descriptionLabel')}
                    value={editDescription}
                    onChange={setEditDescription}
                    placeholder={t('sidepanel.projectsPage.descriptionPlaceholder')}
                  />
                  <TextAreaField
                    label={t('sidepanel.projectsPage.instructionsTitle')}
                    value={editInstructions}
                    onChange={setEditInstructions}
                    placeholder={t('sidepanel.projectsPage.instructionsPlaceholder')}
                    rows={6}
                  />
                  <div className="ds-project-edit-actions">
                    <Button
                      type="button"
                      size="sm"
                      onClick={saveProject}
                      disabled={!editName.trim()}
                      className="ds-btn-primary ds-project-submit"
                    >
                      {t('common.saveChanges')}
                    </Button>
                  </div>
                </div>
              )}

              <section className="ds-project-assignment-panel" aria-label={t('sidepanel.projectsPage.projectAssignmentTitle')}>
                <div className="ds-project-assignment-row">
                  <div className="ds-project-assignment-copy">
                    <span>{t('sidepanel.projectsPage.nextConversationTitle')}</span>
                    <strong>
                      {nextConversationStatus}
                    </strong>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPending(selectedProjectIsPending ? null : selectedProject.id)}
                    className="ds-btn-secondary ds-project-small-button"
                  >
                    {selectedProjectIsPending
                      ? t('sidepanel.projectsPage.cancelNextConversation')
                      : t('sidepanel.projectsPage.useNextConversation')}
                  </Button>
                </div>
                <div className="ds-project-assignment-row">
                  <div className="ds-project-assignment-copy">
                    <span>{t('sidepanel.projectsPage.currentConversation')}</span>
                    <strong>
                      {currentConversation
                        ? currentConversation.title
                        : t('sidepanel.projectsPage.noCurrentConversation')}
                    </strong>
                    {currentConversation && <small>{currentConversationStatus}</small>}
                  </div>
                  <div className="ds-project-command-row">
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={refreshCurrentConversation}
                      className="ds-btn-secondary ds-project-mini-button"
                    >
                      {t('common.refresh')}
                    </Button>
                    {currentConversation && (
                      currentConversationBelongsToSelected ? (
                        <>
                          <Badge variant="outline" className="ds-project-linked-state">
                            {t('sidepanel.projectsPage.currentConversationLinked')}
                          </Badge>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={addCurrentConversation}
                            className="ds-btn-secondary ds-project-small-button"
                          >
                            {t('sidepanel.projectsPage.refreshCurrentConversationLink')}
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={addCurrentConversation}
                          className="ds-btn-secondary ds-project-small-button"
                        >
                          {currentConversationProject
                            ? t('sidepanel.projectsPage.moveCurrentConversation')
                            : t('sidepanel.projectsPage.addCurrentConversation')}
                        </Button>
                      )
                    )}
                  </div>
                </div>
              </section>

              <section className="ds-project-section">
                <div className="ds-project-section-head">
                  <h3>{t('sidepanel.projectsPage.instructionsTitle')}</h3>
                </div>
                {selectedProject.instructions.trim() ? (
                  <>
                    <div
                      ref={instructionsBodyRef}
                      className={`ds-project-instructions-body${showFullInstructions ? ' ds-project-instructions-body-full' : ''}`}
                    >
                      {selectedProject.instructions}
                    </div>
                    {instructionsNeedDisclosure && (
                      <Button
                        type="button"
                        variant="link"
                        size="xs"
                        onClick={() => setShowFullInstructions((visible) => !visible)}
                        className="ds-project-text-button"
                        aria-expanded={showFullInstructions}
                      >
                        {showFullInstructions
                          ? t('sidepanel.projectsPage.hideFullInstructions')
                          : t('sidepanel.projectsPage.showFullInstructions')}
                      </Button>
                    )}
                  </>
                ) : (
                  <div className="ds-project-empty-line">
                    {t('sidepanel.projectsPage.emptyInstructions')}
                  </div>
                )}
              </section>

              <section className="ds-project-section">
                <div className="ds-project-section-head">
                  <h3>{t('sidepanel.projectsPage.conversationsTitle')}</h3>
                </div>
                {projectConversations.length === 0 ? (
                  <div className="ds-project-empty-line">
                    {t('sidepanel.projectsPage.emptyConversations')}
                  </div>
                ) : (
                  <div className="ds-project-conversation-list">
                    {projectConversations.map((conversation) => (
                      <div key={conversation.conversationId} className="ds-project-conversation-row">
                        <a href={conversation.url || '#'} target="_blank" rel="noreferrer">
                          {conversation.title}
                        </a>
                        <span>
                          {formatAge(conversation.lastSeenAt, t)}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={() => removeConversation(conversation)}
                          className="ds-btn-secondary ds-project-mini-button"
                        >
                          {t('common.remove')}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="ds-project-section">
                <div className="ds-project-section-head ds-project-section-head-row">
                  <div>
                    <h3>
                      {t('sidepanel.projectsPage.memoriesTitle')}
                    </h3>
                  </div>
                  {memoryLoadError ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void loadAll(selectedProject.id)}
                      className="ds-btn-secondary ds-project-small-button"
                    >
                      {t('common.retry')}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => { setEditingMemory(null); setShowMemoryForm(!showMemoryForm); }}
                      className="ds-btn-secondary ds-project-small-button"
                      aria-expanded={showMemoryForm}
                      aria-controls="ds-project-memory-form"
                    >
                      {t('common.add')}
                    </Button>
                  )}
                </div>
                {showMemoryForm && (
                  <div id="ds-project-memory-form">
                    <MemoryForm
                      initial={editingMemory}
                      onSave={saveProjectMemory}
                      onCancel={() => { setShowMemoryForm(false); setEditingMemory(null); }}
                    />
                  </div>
                )}
                {memoryLoadError ? (
                  <Alert variant="destructive" className="ds-project-source-alert">
                    <AlertDescription>{memoryLoadError}</AlertDescription>
                  </Alert>
                ) : projectMemories.length === 0 ? (
                  <div className="ds-project-empty-line">
                    {t('sidepanel.projectsPage.emptyMemories')}
                  </div>
                ) : (
                  <div className="ds-project-memory-list">
                    {projectMemories.map((memory) => (
                      <ProjectMemoryRow
                        key={memory.id}
                        memory={memory}
                        onDelete={() => deleteMemory(memory.id!)}
                        onEdit={() => { setEditingMemory(memory); setShowMemoryForm(true); }}
                        onTogglePin={() => toggleMemoryPin(memory)}
                      />
                    ))}
                  </div>
                )}
              </section>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

type ProjectReadinessTone = 'ready' | 'attention';
type ProjectFactTone = 'normal' | 'muted' | 'attention';
type ProjectStatusAction = 'editInstructions' | 'linkCurrent' | 'setNext';

interface ProjectStatusModel {
  tone: ProjectReadinessTone;
  status: string;
  description: string;
  project: string;
  openChat: string;
  openChatTone: ProjectFactTone;
  nextChat: string;
  nextChatTone: ProjectFactTone;
  memory: string;
  memoryTone: ProjectFactTone;
  action: ProjectStatusAction | null;
  actionLabel: string;
}

function createProjectStatus({
  project,
  hasInstructions,
  currentConversation,
  currentConversationProject,
  currentConversationBelongsToSelected,
  selectedProjectIsPending,
  pendingProject,
  memoryCount,
  t,
}: {
  project: ProjectContext;
  hasInstructions: boolean;
  currentConversation: CurrentDeepSeekConversation | null;
  currentConversationProject: ProjectConversation | null;
  currentConversationBelongsToSelected: boolean;
  selectedProjectIsPending: boolean;
  pendingProject: ProjectContext | null;
  memoryCount: number;
  t: ReturnType<typeof useI18n>['t'];
}): ProjectStatusModel {
  const hasOpenChat = Boolean(currentConversation);
  const openChat = currentConversationBelongsToSelected
    ? t('sidepanel.projectsPage.currentConversationLinked')
    : currentConversationProject
      ? t('sidepanel.projectsPage.currentConversationLinkedElsewhere')
      : hasOpenChat
        ? t('sidepanel.projectsPage.currentConversationReady')
        : t('sidepanel.projectsPage.noCurrentConversation');
  const nextChat = selectedProjectIsPending
    ? t('sidepanel.projectsPage.nextConversationAssigned')
    : pendingProject
      ? t('sidepanel.projectsPage.nextConversationAssignedElsewhere', { name: pendingProject.name })
      : t('sidepanel.projectsPage.nextConversationNotAssigned');
  const base = {
    project: project.name,
    openChat,
    openChatTone: currentConversationBelongsToSelected
      ? 'normal'
      : hasOpenChat
        ? 'attention'
        : 'muted',
    nextChat,
    nextChatTone: selectedProjectIsPending ? 'normal' : 'muted',
    memory: t('sidepanel.projectsPage.projectStatusMemoryCount', { count: memoryCount }),
    memoryTone: memoryCount > 0 ? 'normal' : 'muted',
  } satisfies Pick<ProjectStatusModel,
    | 'project'
    | 'openChat'
    | 'openChatTone'
    | 'nextChat'
    | 'nextChatTone'
    | 'memory'
    | 'memoryTone'
  >;

  if (!hasInstructions) {
    return {
      ...base,
      tone: 'attention',
      status: t('sidepanel.projectsPage.projectStatusNeedsInstructions'),
      description: t('sidepanel.projectsPage.projectStatusNeedsInstructionsDescription'),
      action: 'editInstructions',
      actionLabel: t('sidepanel.projectsPage.projectStatusActionEditInstructions'),
    };
  }

  if (selectedProjectIsPending || currentConversationBelongsToSelected) {
    return {
      ...base,
      tone: 'ready',
      status: t('sidepanel.projectsPage.projectStatusReady'),
      description: t('sidepanel.projectsPage.projectStatusReadyDescription'),
      action: null,
      actionLabel: t('sidepanel.projectsPage.projectStatusActionSetNext'),
    };
  }

  if (currentConversation) {
    const moving = Boolean(currentConversationProject);
    return {
      ...base,
      tone: 'attention',
      status: t(moving
        ? 'sidepanel.projectsPage.projectStatusMoveChat'
        : 'sidepanel.projectsPage.projectStatusLinkChat'),
      description: t(moving
        ? 'sidepanel.projectsPage.projectStatusMoveChatDescription'
        : 'sidepanel.projectsPage.projectStatusLinkChatDescription'),
      action: 'linkCurrent',
      actionLabel: t(moving
        ? 'sidepanel.projectsPage.projectStatusActionMoveChat'
        : 'sidepanel.projectsPage.projectStatusActionLinkChat'),
    };
  }

  return {
    ...base,
    tone: 'attention',
    status: t('sidepanel.projectsPage.projectStatusSetNext'),
    description: t('sidepanel.projectsPage.projectStatusSetNextDescription'),
    action: 'setNext',
    actionLabel: t('sidepanel.projectsPage.projectStatusActionSetNext'),
  };
}

function ProjectStatusRow({ label, value, tone = 'normal' }: {
  label: string;
  value: string;
  tone?: ProjectFactTone;
}) {
  return (
    <div className={`ds-project-status-row ds-project-status-row-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProjectMemoryRow({
  memory,
  onDelete,
  onEdit,
  onTogglePin,
}: {
  memory: Memory;
  onDelete: () => void;
  onEdit: () => void;
  onTogglePin: () => void;
}) {
  const { t } = useI18n();
  const typeInfo = MEMORY_TYPE_MAP[memory.type] ?? MEMORY_TYPE_MAP.topic;
  const pinTitle = memory.pinned ? t('sidepanel.memory.actions.unpin') : t('sidepanel.memory.actions.pin');
  const tagLine = memory.tags.map((tag) => `#${tag}`).join(' ');

  return (
    <article className="ds-project-memory-row">
      <div className="ds-project-memory-copy">
        <div className="ds-project-memory-kicker">
          <span>{t(typeInfo.labelKey)}</span>
          {memory.pinned && (
            <svg className="ds-project-memory-pinned" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path d={SVG_PATHS.star} />
            </svg>
          )}
        </div>
        <h4>{memory.name}</h4>
        <p>{memory.content}</p>
        <div className="ds-project-memory-footer">
          {tagLine && <span className="ds-project-memory-tags">{tagLine}</span>}
          <span>{formatAge(memory.createdAt, t)}</span>
        </div>
      </div>
      <div className="ds-project-memory-actions">
        <WorkbenchTooltip label={pinTitle}>
          <Button type="button" variant="ghost" size="icon-xs" onClick={onTogglePin} className="ds-project-memory-action" aria-label={pinTitle}>
            <svg fill={memory.pinned ? 'currentColor' : 'none'} viewBox="0 0 20 20" stroke="currentColor" strokeWidth={memory.pinned ? 0 : 1.5} aria-hidden="true">
              <path d={SVG_PATHS.star} />
            </svg>
          </Button>
        </WorkbenchTooltip>
        <WorkbenchTooltip label={t('common.edit')}>
          <Button type="button" variant="ghost" size="icon-xs" onClick={onEdit} className="ds-project-memory-action" aria-label={t('common.edit')}>
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.edit} />
            </svg>
          </Button>
        </WorkbenchTooltip>
        <WorkbenchTooltip label={t('common.delete')}>
          <Button type="button" variant="ghost" size="icon-xs" onClick={onDelete} className="ds-project-memory-action ds-project-memory-action-danger" aria-label={t('common.delete')}>
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.trash} />
            </svg>
          </Button>
        </WorkbenchTooltip>
      </div>
    </article>
  );
}

function FolderIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  );
}

function unwrapProjectResponse<T = unknown>(response: unknown, missingMessage: string): T {
  return unwrapRuntimeResponse<T>(response, missingMessage);
}

function isProjectContextState(value: unknown): value is ProjectContextState {
  if (!value || typeof value !== 'object') return false;
  const state = value as ProjectContextState;
  return state.schemaVersion === PROJECT_CONTEXT_SCHEMA_VERSION &&
    Array.isArray(state.projects) &&
    Array.isArray(state.conversations) &&
    (state.pendingProjectId === null || typeof state.pendingProjectId === 'string');
}

function formatAge(timestamp: number, t: ReturnType<typeof useI18n>['t']): string {
  const mins = Math.floor((Date.now() - timestamp) / 60000);
  if (mins < 1) return t('sidepanel.memory.age.justNow');
  if (mins < 60) return t('sidepanel.memory.age.minutesAgo', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('sidepanel.memory.age.hoursAgo', { count: hours });
  return t('sidepanel.memory.age.daysAgo', { count: Math.floor(hours / 24) });
}
