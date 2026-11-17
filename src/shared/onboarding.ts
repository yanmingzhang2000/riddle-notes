/**
 * 首次使用引导：白名单与全局状态
 *
 * 状态保存在 chrome.storage.local，同一个扩展安装实例下所有页面和平台共享一份。
 * content script、service worker 和设置页都可以直接读写。
 */

export const ONBOARDING_STORAGE_KEY = 'onboardingState';

/** 状态结构版本。本期仅作预留，不按版本重新展示。 */
export const ONBOARDING_VERSION = 1;

/**
 * 引导白名单，按适配器的 platformId 配置。
 * 新增平台时，在这里加一项即可，不需要改动状态逻辑。
 */
export const ONBOARDING_PLATFORM_WHITELIST: readonly string[] = ['chatgpt'];

/**
 * pending：全新安装，还没有展示过（或被设置页重置）。
 * shown：已经展示过，不再自动触发。
 */
export type OnboardingStatus = 'pending' | 'shown';

export interface OnboardingState {
  status: OnboardingStatus;
  version: number;
  /** 展示时间（ISO 字符串）。pending 时为 null。 */
  shownAt: string | null;
  /** 触发展示的平台 platformId。pending 或升级用户为 null。 */
  platform: string | null;
}

function createState(status: OnboardingStatus, platform: string | null): OnboardingState {
  return {
    status,
    version: ONBOARDING_VERSION,
    shownAt: status === 'shown' ? new Date().toISOString() : null,
    platform,
  };
}

async function writeState(state: OnboardingState): Promise<void> {
  await chrome.storage.local.set({ [ONBOARDING_STORAGE_KEY]: state });
}

/** 判断平台是否在引导白名单内 */
export function isOnboardingPlatform(platformId: string): boolean {
  return ONBOARDING_PLATFORM_WHITELIST.includes(platformId);
}

/** 读取引导状态。没有记录，或记录格式不合法时返回 null。 */
export async function getOnboardingState(): Promise<OnboardingState | null> {
  const result = await chrome.storage.local.get(ONBOARDING_STORAGE_KEY);
  const state = result[ONBOARDING_STORAGE_KEY];

  if (
    state &&
    typeof state === 'object' &&
    (state.status === 'pending' || state.status === 'shown')
  ) {
    return state as OnboardingState;
  }

  return null;
}

/**
 * 尝试占用本次引导展示。
 *
 * 返回 true 表示当前页面应该展示引导，此时状态已经写成 shown（展示即标记）。
 * 返回 false 表示不展示：平台不在白名单、已经展示过，或读写存储出错。
 * 存储出错时宁可不展示，也不能让用户重复看到。
 */
export async function claimOnboarding(platformId: string): Promise<boolean> {
  if (!isOnboardingPlatform(platformId)) {
    return false;
  }

  try {
    const state = await getOnboardingState();
    if (state?.status === 'shown') {
      return false;
    }

    await writeState(createState('shown', platformId));
    return true;
  } catch (error) {
    console.warn('[Sidecar] Onboarding state unavailable:', error);
    return false;
  }
}

/**
 * 处理扩展安装/更新事件，在 background 的 onInstalled 中调用。
 *
 * - install：没有记录时写入 pending，表示这是带引导功能的新安装。
 * - update：没有记录说明是引导功能上线前就在用的老用户，直接标记为已展示。
 *   已经有 pending 记录的新用户升级后仍然保留，访问白名单网站时还会看到引导。
 */
export async function initOnboardingOnInstalled(reason: string): Promise<void> {
  if (reason !== 'install' && reason !== 'update') {
    return;
  }

  const existing = await getOnboardingState();
  if (existing) {
    return;
  }

  if (reason === 'install') {
    await writeState(createState('pending', null));
  } else {
    await writeState(createState('shown', null));
  }
}

/** 重置引导状态，下次进入白名单网站时再次展示。设置页的"重新查看引导"使用。 */
export async function resetOnboardingState(): Promise<void> {
  await writeState(createState('pending', null));
}
