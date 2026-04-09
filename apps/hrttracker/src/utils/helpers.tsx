import React from 'react';
import { Syringe, Pill, Droplet, Sticker, X } from 'lucide-react';
import { Route, getRouteIcon as getRouteIconCore, getBioDoseMG, getRawDoseMG } from '../../logic';
import { Lang } from '../i18n/translations';

export const formatDate = (date: Date, lang: Lang) => {
    const locale = lang === 'zh' ? 'zh-CN' : (lang === 'ru' ? 'ru-RU' : 'en-US');
    return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
};

export const formatTime = (date: Date) => {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
};

export const getRouteIcon = (route: Route) => {
    switch (route) {
        case Route.injection: return <Syringe className="w-5 h-5 text-pink-400" />;
        case Route.oral: return <Pill className="w-5 h-5 text-blue-500" />;
        case Route.sublingual: return <Pill className="w-5 h-5 text-teal-500" />;
        case Route.gel: return <Droplet className="w-5 h-5 text-cyan-500" />;
        case Route.patchApply: return <Sticker className="w-5 h-5 text-orange-500" />;
        case Route.patchRemove: return <X className="w-5 h-5 text-gray-400" />;
    }
};

export { getBioDoseMG, getRawDoseMG };
