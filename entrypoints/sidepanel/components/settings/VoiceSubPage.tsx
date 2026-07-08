import VoiceSettingsPanel from '../VoiceSettingsPanel';

/**
 * Voice sub-page. VoiceSettingsPanel owns its chrome.runtime state and renders
 * through shared settings primitives.
 */
export default function VoiceSubPage() {
  return (
    <div className="space-y-5">
      <VoiceSettingsPanel />
    </div>
  );
}
