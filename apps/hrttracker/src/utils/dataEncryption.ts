/**
 * Generic JSON payload encryption helpers used by import / export flows.
 *
 * This file is intentionally separate from `src/utils/crypto.ts`, which is
 * focused on the security-password cookie workflow. Splitting the two avoids
 * mixing account-security concerns with general data export encryption.
 */

async function generateKey(password: string, salt: Uint8Array) {
    const encoder = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    );
    return window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt as any,
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

function buffToBase64(buff: Uint8Array): string {
    const bin = Array.from(buff, (byte) => String.fromCharCode(byte)).join("");
    return btoa(bin);
}

function base64ToBuff(b64: string): Uint8Array {
    const bin = atob(b64);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * Encrypt arbitrary text and return both the encrypted bundle and the randomly
 * generated password needed to decrypt it later.
 */
export async function encryptData(text: string): Promise<{ data: string, password: string }> {
    const password = buffToBase64(window.crypto.getRandomValues(new Uint8Array(12)));
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const key = await generateKey(password, salt);
    const encoder = new TextEncoder();
    const encrypted = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv as any },
        key,
        encoder.encode(text)
    );

    const bundle = {
        encrypted: true,
        iv: buffToBase64(iv),
        salt: buffToBase64(salt),
        data: buffToBase64(new Uint8Array(encrypted))
    };

    return {
        data: JSON.stringify(bundle),
        password
    };
}

/**
 * Decrypt a previously exported JSON bundle. Returns `null` when the payload is
 * malformed or the supplied password is incorrect.
 */
export async function decryptData(jsonString: string, password: string): Promise<string | null> {
    try {
        const bundle = JSON.parse(jsonString);
        if (!bundle.encrypted) return jsonString;

        const salt = base64ToBuff(bundle.salt);
        const iv = base64ToBuff(bundle.iv);
        const data = base64ToBuff(bundle.data);

        const key = await generateKey(password, salt);
        const decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv as any },
            key,
            data as any
        );
        return new TextDecoder().decode(decrypted);
    } catch (error) {
        console.error(error);
        return null;
    }
}
