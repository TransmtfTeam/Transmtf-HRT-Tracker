const SALT_PREFIX = 'hrt-tracker-security-v2-';

/**
 * 从用户名派生加密密钥
 */
async function deriveKey(username: string): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const userSalt = SALT_PREFIX + username;

    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(username + userSalt),
        'PBKDF2',
        false,
        ['deriveKey']
    );

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: encoder.encode(userSalt),
            iterations: 100000,
            hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * 加密字符串
 */
export async function encryptString(text: string, secret: string): Promise<string> {
    const key = await deriveKey(secret);
    const encoder = new TextEncoder();
    const data = encoder.encode(text);

    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encrypted = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv: iv,
        },
        key,
        data
    );

    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);

    return btoa(String.fromCharCode(...combined));
}

/**
 * 解密字符串
 */
export async function decryptString(encryptedData: string, secret: string): Promise<string | null> {
    try {
        const key = await deriveKey(secret);
        const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));

        const iv = combined.slice(0, 12);
        const encrypted = combined.slice(12);

        const decrypted = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: iv,
            },
            key,
            encrypted
        );

        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
    } catch (error) {
        console.error('Failed to decrypt:', error);
        return null;
    }
}
