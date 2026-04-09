// 安全密码加密/解密工具
// 使用 AES-GCM 对称加密

import { deleteCookie, getCookie, setCookie } from './cookies';
import { encryptString, decryptString } from '../../logic';

const SECURITY_PASSWORD_COOKIE = 'hrt-security-pwd';
const SECURITY_PASSWORD_COOKIE_DAYS = 3650;

/**
 * 保存安全密码到 Cookie（加密，长期有效）
 * @returns true if saved successfully, false otherwise
 */
export async function saveSecurityPassword(password: string, username: string): Promise<boolean> {
  try {
    const encrypted = await encryptString(password, username);
    const saved = setCookie(SECURITY_PASSWORD_COOKIE, encrypted, SECURITY_PASSWORD_COOKIE_DAYS);

    if (saved) {
      console.log('Security password saved to cookie successfully');
    } else {
      console.error('Failed to save security password to cookie');
    }

    return saved;
  } catch (error) {
    console.error('Failed to save security password:', error);
    return false;
  }
}

/**
 * 从 Cookie 获取安全密码（解密）
 */
export async function getSecurityPassword(username: string): Promise<string | null> {
  try {
    const encrypted = getCookie(SECURITY_PASSWORD_COOKIE);
    if (!encrypted) return null;

    return await decryptString(encrypted, username);
  } catch (error) {
    console.error('Failed to get security password:', error);
    return null;
  }
}

/**
 * 清除安全密码 Cookie
 * @returns true if deleted successfully, false otherwise
 */
export async function clearSecurityPassword(): Promise<boolean> {
  return deleteCookie(SECURITY_PASSWORD_COOKIE);
}
