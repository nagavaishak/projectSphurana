/**
 * Secure key/value storage backed by `capacitor-secure-storage-plugin`.
 *
 * iOS: Keychain (separate keychain wrapper since plugin v0.5+)
 * Android: EncryptedSharedPreferences
 * Web: localStorage with base64 encoding and a `cap_sec_` prefix
 *
 * Replaces `expo-secure-store` from the mobile app. The plugin throws on
 * missing keys, so `getItem` is wrapped to return `null` instead — matching
 * the shape of `localStorage.getItem` and `expo-secure-store`'s null-on-miss.
 */

import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

export async function setItem(key: string, value: string): Promise<void> {
  await SecureStoragePlugin.set({ key, value });
}

export async function getItem(key: string): Promise<string | null> {
  try {
    const result = await SecureStoragePlugin.get({ key });
    return result.value ?? null;
  } catch {
    // Plugin throws when key is missing — treat as null.
    return null;
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    await SecureStoragePlugin.remove({ key });
  } catch {
    // Removing a missing key is a no-op.
  }
}

export async function clear(): Promise<void> {
  try {
    await SecureStoragePlugin.clear();
  } catch {
    // Best-effort; clear may throw if storage is already empty.
  }
}
