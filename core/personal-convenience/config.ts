import {
  isDeepSeekWebSessionStrategy,
  type DeepSeekWebSessionStrategy,
} from '../chat/session-preference';

export interface PersonalConvenienceConfig {
  enabled: boolean;
  autoReadyCheckBeforeRun: boolean;
  autoRefreshWebAuth: boolean;
  sameSessionStrategy: DeepSeekWebSessionStrategy;
  visualMonitorDefault: boolean;
  reducedConfirmations: boolean;
}

export const DEFAULT_PERSONAL_CONVENIENCE_CONFIG: PersonalConvenienceConfig = {
  enabled: true,
  autoReadyCheckBeforeRun: true,
  autoRefreshWebAuth: true,
  sameSessionStrategy: 'last',
  visualMonitorDefault: true,
  reducedConfirmations: true,
};

const STORAGE_KEY = 'deepseek_pp_personal_convenience';

type LocalStorageArea = Pick<chrome.storage.LocalStorageArea, 'get' | 'set'>;

export async function getPersonalConvenienceConfig(): Promise<PersonalConvenienceConfig> {
  const storage = getLocalStorageArea();
  if (!storage) return DEFAULT_PERSONAL_CONVENIENCE_CONFIG;
  const data = await storage.get(STORAGE_KEY) as Record<string, unknown>;
  return normalizePersonalConvenienceConfig(data[STORAGE_KEY]);
}

export async function savePersonalConvenienceConfig(
  patch: Partial<PersonalConvenienceConfig>,
): Promise<PersonalConvenienceConfig> {
  const current = await getPersonalConvenienceConfig();
  const next = normalizePersonalConvenienceConfig({ ...current, ...patch });
  const storage = getLocalStorageArea();
  if (storage) await storage.set({ [STORAGE_KEY]: next });
  return next;
}

export function normalizePersonalConvenienceConfig(value: unknown): PersonalConvenienceConfig {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PERSONAL_CONVENIENCE_CONFIG };
  const record = value as Record<string, unknown>;
  return {
    enabled: record.enabled !== false,
    autoReadyCheckBeforeRun: record.autoReadyCheckBeforeRun !== false,
    autoRefreshWebAuth: record.autoRefreshWebAuth !== false,
    sameSessionStrategy: isDeepSeekWebSessionStrategy(record.sameSessionStrategy)
      ? record.sameSessionStrategy
      : DEFAULT_PERSONAL_CONVENIENCE_CONFIG.sameSessionStrategy,
    visualMonitorDefault: record.visualMonitorDefault !== false,
    reducedConfirmations: record.reducedConfirmations !== false,
  };
}

function getLocalStorageArea(): LocalStorageArea | null {
  if (typeof chrome === 'undefined') return null;
  return chrome.storage?.local ?? null;
}
