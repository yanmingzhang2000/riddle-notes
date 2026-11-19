import { RiddleVaultDB } from '../../src/db/vault-schema';
import type { VaultKeys, VaultRecord } from '../../src/vault/types';

/** 每个测试用一个全新的库名,互不影响。fake-indexeddb 在内存里,不会碰真实数据 */
let counter = 0;
export function createTestVaultDb(): RiddleVaultDB {
  return new RiddleVaultDB(`RiddleVaultDB-test-${Date.now()}-${counter++}`);
}

const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);

export function makeKeys(overrides: Partial<VaultKeys> = {}): VaultKeys {
  return {
    id: 'singleton',
    wrapper: {
      master: {
        wrappedKey: bytes(48, 1),
        iv: bytes(12, 2),
        kdf: { algorithm: 'PBKDF2-SHA256', iterations: 600_000, salt: bytes(32, 3) },
      },
      recovery: { wrappedKey: bytes(48, 4), iv: bytes(12, 5) },
      keyId: bytes(8, 6),
      revision: 1,
      formatVersion: 1,
    },
    recoveryRotationRequired: false,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

export function makeRecord(id: string, overrides: Partial<VaultRecord> = {}): VaultRecord {
  return {
    id,
    formatVersion: 1,
    keyId: bytes(8, 6),
    type: 'api_key',
    createdAt: 1000,
    updatedAt: 1000,
    summary: { iv: bytes(12, 7), data: bytes(30, 8) },
    secret: { iv: bytes(12, 9), data: bytes(40, 10) },
    ...overrides,
  };
}
