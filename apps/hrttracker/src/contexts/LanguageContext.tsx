import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { TRANSLATIONS, Lang } from '../i18n/translations';

const LanguageContext = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: string) => string } | null>(null);

export const useTranslation = () => {
    const ctx = useContext(LanguageContext);
    if (!ctx) throw new Error("useTranslation must be used within LanguageProvider");
    return ctx;
};

export const LanguageProvider = ({ children }: { children: React.ReactNode }) => {
    const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('hrt-lang') as Lang) || 'zh');
    const isInitialLangRef = useRef(true);

    useEffect(() => {
        localStorage.setItem('hrt-lang', lang);
        document.title = (lang.startsWith('zh') || lang === 'yue') ? "HRT 记录" : "Transmtf HRT Tracker";
        if (isInitialLangRef.current) {
            isInitialLangRef.current = false;
            return;
        }
        const lastModified = new Date().toISOString();
        localStorage.setItem('hrt-last-modified', lastModified);
        window.dispatchEvent(new CustomEvent('hrt-local-data-updated', { detail: { key: 'hrt-lang', lastModified } }));
    }, [lang]);

    const t = (key: string) => {
        const pack = (TRANSLATIONS as any)[lang] || TRANSLATIONS.zh;
        return pack[key] ?? TRANSLATIONS.zh[key as keyof typeof TRANSLATIONS.zh] ?? TRANSLATIONS.en[key as keyof typeof TRANSLATIONS.en] ?? key;
    };

    return (
        <LanguageContext.Provider value={{ lang, setLang, t }}>
            {children}
        </LanguageContext.Provider>
    );
};
