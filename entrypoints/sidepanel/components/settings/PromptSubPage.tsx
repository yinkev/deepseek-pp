import PromptControlPanel from '../PromptControlPanel';
import ScenarioManager from '../ScenarioManager';

/**
 * Prompt sub-page.
 *
 * PromptControlPanel owns its runtime state and renders through shared settings
 * primitives. ScenarioManager keeps its own surface because it manages a larger
 * command list.
 */
export default function PromptSubPage() {
  return (
    <div className="space-y-5">
      <PromptControlPanel />
      <ScenarioManager />
    </div>
  );
}
