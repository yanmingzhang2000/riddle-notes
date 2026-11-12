import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { UpdateService } from '../src/shared/update-service';
import { db } from '../src/db/schema';

// Mock chrome.runtime
const mockChrome = {
  runtime: {
    getManifest: vi.fn(() => ({ version: '1.0.0' })),
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  storage: {
    local: {
      set: vi.fn(),
      get: vi.fn(),
    },
  },
};

global.chrome = mockChrome as any;

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('UpdateService', () => {
  let updateService: UpdateService;

  beforeEach(() => {
    vi.clearAllMocks();
    updateService = UpdateService.getInstance();
  });

  afterEach(async () => {
    await db.appSettings.clear();
  });

  describe('getAppSettings', () => {
    test('should return default settings when no settings exist', async () => {
      const settings = await updateService.getAppSettings();
      
      expect(settings).toEqual({
        updateCheckEnabled: true,
        updateManifestUrl: 'https://raw.githubusercontent.com/yanmingzhang2000/sidecar/main/update-manifest.json',
      });
    });

    test('should return existing settings', async () => {
      await db.appSettings.add({
        updateCheckEnabled: false,
        updateManifestUrl: 'https://custom.example.com/manifest.json',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const settings = await updateService.getAppSettings();
      
      expect(settings.updateCheckEnabled).toBe(false);
      expect(settings.updateManifestUrl).toBe('https://custom.example.com/manifest.json');
    });
  });

  describe('updateAppSettings', () => {
    test('should create new settings when none exist', async () => {
      await updateService.updateAppSettings({
        updateCheckEnabled: false,
        updateManifestUrl: 'https://test.example.com/manifest.json',
      });

      const settings = await db.appSettings.get(1);
      expect(settings).toBeDefined();
      expect(settings?.updateCheckEnabled).toBe(false);
      expect(settings?.updateManifestUrl).toBe('https://test.example.com/manifest.json');
    });

    test('should update existing settings', async () => {
      await db.appSettings.add({
        updateCheckEnabled: true,
        updateManifestUrl: 'https://old.example.com/manifest.json',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await updateService.updateAppSettings({
        updateCheckEnabled: false,
      });

      const settings = await db.appSettings.get(1);
      expect(settings?.updateCheckEnabled).toBe(false);
      expect(settings?.updateManifestUrl).toBe('https://old.example.com/manifest.json');
    });
  });

  describe('fetchUpdateManifest', () => {
    test('should fetch and validate manifest successfully', async () => {
      const mockManifest = {
        latestVersion: '1.1.0',
        publishedAt: '2026-11-12T10:00:00+08:00',
        releaseNotes: 'Test release',
        downloadUrl: 'https://example.com/download/1.1.0',
        minSupportedVersion: '1.0.0',
        isMandatory: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockManifest),
      });

      const manifest = await updateService.fetchUpdateManifest('https://example.com/manifest.json');
      
      expect(manifest).toEqual(mockManifest);
      expect(mockFetch).toHaveBeenCalledWith('https://example.com/manifest.json', expect.any(Object));
    });

    test('should reject non-HTTPS URLs', async () => {
      await expect(
        updateService.fetchUpdateManifest('http://example.com/manifest.json')
      ).rejects.toThrow('更新清单必须使用HTTPS');
    });

    test('should throw error for invalid manifest format', async () => {
      const invalidManifest = {
        latestVersion: '1.1.0',
        // Missing required fields
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(invalidManifest),
      });

      await expect(
        updateService.fetchUpdateManifest('https://example.com/manifest.json')
      ).rejects.toThrow('更新清单缺少必需字段');
    });
  });

  describe('compareVersions', () => {
    test('should detect available update', () => {
      const manifest = {
        latestVersion: '1.1.0',
        publishedAt: '2026-11-12T10:00:00+08:00',
        releaseNotes: 'Test',
        downloadUrl: 'https://example.com/download',
        minSupportedVersion: '1.0.0',
        isMandatory: false,
      };

      const currentVersion = '1.0.0';
      const comparison = (updateService as any).compareVersions(currentVersion, manifest);
      
      expect(comparison.hasUpdate).toBe(true);
      expect(comparison.isMandatory).toBe(false);
      expect(comparison.isBelowMinSupported).toBe(false);
    });

    test('should detect mandatory update', () => {
      const manifest = {
        latestVersion: '1.2.0',
        publishedAt: '2026-11-12T10:00:00+08:00',
        releaseNotes: 'Test',
        downloadUrl: 'https://example.com/download',
        minSupportedVersion: '1.1.0',
        isMandatory: true,
      };

      const currentVersion = '1.0.0';
      const comparison = (updateService as any).compareVersions(currentVersion, manifest);
      
      expect(comparison.hasUpdate).toBe(true);
      expect(comparison.isMandatory).toBe(true);
      expect(comparison.isBelowMinSupported).toBe(true);
    });

    test('should detect no update needed', () => {
      const manifest = {
        latestVersion: '1.0.0',
        publishedAt: '2026-11-12T10:00:00+08:00',
        releaseNotes: 'Test',
        downloadUrl: 'https://example.com/download',
        minSupportedVersion: '1.0.0',
        isMandatory: false,
      };

      const currentVersion = '1.0.0';
      const comparison = (updateService as any).compareVersions(currentVersion, manifest);
      
      expect(comparison.hasUpdate).toBe(false);
      expect(comparison.isMandatory).toBe(false);
      expect(comparison.isBelowMinSupported).toBe(false);
    });
  });

  describe('version parsing and comparison', () => {
    test('should parse valid version strings', () => {
      const parseVersion = (updateService as any).parseVersion.bind(updateService);
      
      expect(parseVersion('1.0.0')).toEqual([1, 0, 0]);
      expect(parseVersion('2.1.3')).toEqual([2, 1, 3]);
      expect(parseVersion('3')).toEqual([3]);
    });

    test('should reject invalid version strings', () => {
      const parseVersion = (updateService as any).parseVersion.bind(updateService);
      
      expect(() => parseVersion('')).toThrow();
      expect(() => parseVersion('1.0.a')).toThrow();
      expect(() => parseVersion('1.0.0.')).toThrow();
    });

    test('should compare version numbers correctly', () => {
      const isVersionGreater = (updateService as any).isVersionGreater.bind(updateService);
      
      expect(isVersionGreater([1, 1, 0], [1, 0, 0])).toBe(true);
      expect(isVersionGreater([2, 0, 0], [1, 9, 9])).toBe(true);
      expect(isVersionGreater([1, 0, 0], [1, 0, 0])).toBe(false);
      expect(isVersionGreater([1, 0, 0], [1, 1, 0])).toBe(false);
    });

    test('should compare version numbers with different lengths', () => {
      const isVersionGreater = (updateService as any).isVersionGreater.bind(updateService);
      
      expect(isVersionGreater([2, 0], [1, 9, 9, 9])).toBe(true);
      expect(isVersionGreater([1, 0, 0, 1], [1, 0, 0])).toBe(true);
    });
  });

  describe('checkForUpdates', () => {
    beforeEach(async () => {
      await db.appSettings.add({
        updateCheckEnabled: true,
        updateManifestUrl: 'https://example.com/manifest.json',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const mockManifest = {
        latestVersion: '1.1.0',
        publishedAt: '2026-11-12T10:00:00+08:00',
        releaseNotes: 'Test release notes',
        downloadUrl: 'https://example.com/download/1.1.0',
        minSupportedVersion: '1.0.0',
        isMandatory: false,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockManifest),
      });
    });

    test('should check for updates successfully', async () => {
      const result = await updateService.checkForUpdates();
      
      expect(result.hasUpdate).toBe(true);
      expect(result.currentVersion).toBe('1.0.0');
      expect(result.latestVersion).toBe('1.1.0');
      expect(result.isMandatory).toBe(false);
    });

    test('should respect update check disabled setting', async () => {
      await updateService.updateAppSettings({ updateCheckEnabled: false });
      
      await expect(updateService.checkForUpdates()).rejects.toThrow('更新检查已禁用');
    });

    test('should handle fetch errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      
      await expect(updateService.checkForUpdates()).rejects.toThrow('无法获取更新清单');
    });
  });

  describe('remindLater and dismissUpdate', () => {
    beforeEach(async () => {
      await db.appSettings.add({
        updateCheckEnabled: true,
        updateManifestUrl: 'https://example.com/manifest.json',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    test('should set remind later', async () => {
      await updateService.remindLater('1.1.0');
      
      const settings = await db.appSettings.get(1);
      expect(settings?.lastDismissedVersion).toBe('1.1.0');
    });

    test('should dismiss update', async () => {
      await updateService.dismissUpdate('1.1.0');
      
      const settings = await db.appSettings.get(1);
      expect(settings?.lastDismissedVersion).toBe('1.1.0');
      expect(settings?.lastNotifiedVersion).toBe('1.1.0');
    });
  });
});