/**
 * 匿名使用统计模块
 * 
 * 功能：
 * - 生成和管理匿名安装 ID
 * - 向 Umami 上报使用事件（保存次数、活跃天数等）
 * - 用户可在设置里关闭统计，默认开启
 * 
 * 隐私承诺：
 * - 不上报笔记内容、标题、链接
 * - 不上报保险箱相关操作
 * - 只上报事件名和计数
 * - 使用随机生成的安装 ID（不含个人信息）
 * - Umami 服务端会收到 IP 和 User-Agent（用于统计地区和设备）
 */

const UMAMI_WEBSITE_ID = '77c08009-58cd-4c8a-9089-dfab2168498e';
const UMAMI_ENDPOINT = 'https://gateway.umami.is/api/send';
const STORAGE_KEY_INSTALL_ID = 'analytics_install_id';
const STORAGE_KEY_ENABLED = 'analytics_enabled';
const DAILY_HEARTBEAT_ALARM = 'analytics_daily_heartbeat';

/**
 * 生成随机的安装 ID（UUID v4 格式）
 */
function generateInstallId(): string {
  return crypto.randomUUID();
}

/**
 * 获取安装 ID，不存在时自动生成
 */
export async function getInstallId(): Promise<string> {
  const result = await chrome.storage.local.get(STORAGE_KEY_INSTALL_ID);
  
  if (result[STORAGE_KEY_INSTALL_ID]) {
    return result[STORAGE_KEY_INSTALL_ID];
  }
  
  const newId = generateInstallId();
  await chrome.storage.local.set({ [STORAGE_KEY_INSTALL_ID]: newId });
  return newId;
}

/**
 * 检查统计是否已启用（默认 true）
 */
export async function isAnalyticsEnabled(): Promise<boolean> {
  const result = await chrome.storage.local.get(STORAGE_KEY_ENABLED);
  
  // 默认开启
  if (result[STORAGE_KEY_ENABLED] === undefined) {
    return true;
  }
  
  return result[STORAGE_KEY_ENABLED] === true;
}

/**
 * 设置统计开关
 */
export async function setAnalyticsEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_ENABLED]: enabled });
}

/**
 * 向 Umami 发送事件
 * @param eventName 事件名
 * @param url 虚拟路径，用于在 Umami 里区分事件来源
 */
async function trackEvent(eventName: string, url: string): Promise<void> {
  try {
    // 检查开关
    const enabled = await isAnalyticsEnabled();
    if (!enabled) {
      return;
    }
    
    // 获取安装 ID
    const installId = await getInstallId();
    
    // 构造请求体
    const payload = {
      type: 'event',
      payload: {
        hostname: 'extension.riddle-notes',
        language: navigator.language || 'en-US',
        referrer: '',
        screen: `${screen.width}x${screen.height}`,
        title: eventName,
        url: url,
        website: UMAMI_WEBSITE_ID,
        name: eventName,
        id: installId, // 匿名安装 ID
      },
    };
    
    // 发送请求（静默失败，不影响扩展功能）
    await fetch(UMAMI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    // 静默失败，只记录到 console
    console.warn('[Analytics] Failed to track event:', eventName, error);
  }
}

/**
 * 上报安装事件
 */
export async function trackInstall(): Promise<void> {
  await trackEvent('ext_install', '/extension/install');
}

/**
 * 上报每日活跃
 */
export async function trackDailyActive(): Promise<void> {
  await trackEvent('ext_daily_active', '/extension/daily');
}

/**
 * 上报保存 Prompt 事件
 */
export async function trackSavePrompt(): Promise<void> {
  await trackEvent('ext_save_prompt', '/extension/save');
}

/**
 * 上报手动笔记创建（如果有的话）
 */
export async function trackManualNoteCreate(): Promise<void> {
  await trackEvent('ext_manual_note', '/extension/manual_note');
}

/**
 * 设置每日心跳（在 service worker 启动时调用）
 */
export async function setupDailyHeartbeat(): Promise<void> {
  // 清除旧的 alarm（如果存在）
  await chrome.alarms.clear(DAILY_HEARTBEAT_ALARM);
  
  // 创建新的 alarm，每 24 小时触发一次
  await chrome.alarms.create(DAILY_HEARTBEAT_ALARM, {
    periodInMinutes: 24 * 60, // 24 小时
    when: Date.now() + 24 * 60 * 60 * 1000, // 首次在 24 小时后
  });
}

/**
 * 监听 alarm 事件（在 service worker 里调用）
 */
export function listenForHeartbeat(): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === DAILY_HEARTBEAT_ALARM) {
      trackDailyActive();
    }
  });
}
