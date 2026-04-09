import React from 'react';
import { useTranslation } from '../contexts/LanguageContext';
import { FlaskConical, Pill, BrainCircuit, TrendingUp, X } from 'lucide-react';

const ModelInfoModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
    const { t } = useTranslation();

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center z-[60] animate-in fade-in duration-200 p-4">
            <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 w-full max-w-lg animate-in slide-in-from-bottom duration-300 overflow-hidden">
                <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
                    <h3 className="text-lg font-bold text-gray-900">{t('model.title')}</h3>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition"
                    >
                        <X size={16} className="text-gray-500" />
                    </button>
                </div>

                <div className="px-6 py-5 space-y-5 overflow-y-auto max-h-[70vh]">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-pink-50 flex items-center justify-center">
                                <FlaskConical size={14} className="text-pink-500" />
                            </div>
                            <p className="text-sm font-bold text-gray-800">{t('model.e2.title')}</p>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed pl-9">{t('model.e2.body')}</p>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center">
                                <Pill size={14} className="text-purple-500" />
                            </div>
                            <p className="text-sm font-bold text-gray-800">{t('model.cpa.title')}</p>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed pl-9">{t('model.cpa.body')}</p>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                                <BrainCircuit size={14} className="text-blue-500" />
                            </div>
                            <p className="text-sm font-bold text-gray-800">{t('model.ekf.title')}</p>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed pl-9">{t('model.ekf.body')}</p>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-rose-50 flex items-center justify-center">
                                <TrendingUp size={14} className="text-rose-500" />
                            </div>
                            <p className="text-sm font-bold text-gray-800">{t('model.ou.title')}</p>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed pl-9">{t('model.ou.body')}</p>
                    </div>
                </div>

                <div className="px-6 pb-6 pt-4">
                    <button
                        onClick={onClose}
                        className="w-full py-3 bg-gray-900 text-white text-sm font-bold rounded-xl hover:bg-gray-800 transition"
                    >
                        {t('btn.ok')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ModelInfoModal;
