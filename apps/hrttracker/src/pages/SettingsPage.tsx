import React, { useMemo, useState } from 'react';
import { useTranslation } from '../contexts/LanguageContext';
import { useDialog } from '../contexts/DialogContext';
import { useAuth } from '../contexts/AuthContext';
import { useAppData } from '../contexts/AppDataContext';
import {
    Languages,
    Upload,
    Download,
    Copy,
    Trash2,
    Info,
    Github,
    AlertTriangle,
    AtSign,
    BarChart2,
    Settings as SettingsIcon,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

import { DoseEvent, LabResult, encryptData, decryptData, computeDataHash } from '../../logic';
import { APP_VERSION } from '../constants';
import CustomSelect from '../components/CustomSelect';
import ImportModal from '../components/ImportModal';
import ExportModal from '../components/ExportModal';
import PasswordDisplayModal from '../components/PasswordDisplayModal';
import PasswordInputModal from '../components/PasswordInputModal';
import ModelInfoModal from '../components/ModelInfoModal';
import DisclaimerModal from '../components/DisclaimerModal';
import StatisticsModal from '../components/StatisticsModal';
import type { Lang } from '../i18n/translations';
import flagCN from '../assets/flags/cn.svg';
import flagTW from '../assets/flags/tw.svg';
import flagHK from '../assets/flags/hk.svg';
import flagUS from '../assets/flags/us.svg';
import flagJP from '../assets/flags/jp.svg';
import flagRU from '../assets/flags/ru.svg';
import flagUA from '../assets/flags/ua.svg';

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord => {
    return typeof value === 'object' && value !== null;
};

const toNumber = (value: unknown): number | null => {
    const next = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(next) ? next : null;
};

const SettingsPage: React.FC = () => {
    const { t, lang, setLang } = useTranslation();
    const { showDialog } = useDialog();
    const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
    const { events, setEvents, weight, setWeight, labResults, setLabResults } = useAppData();

    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [isExportModalOpen, setIsExportModalOpen] = useState(false);
    const [generatedPassword, setGeneratedPassword] = useState('');
    const [isPasswordDisplayOpen, setIsPasswordDisplayOpen] = useState(false);
    const [isPasswordInputOpen, setIsPasswordInputOpen] = useState(false);
    const [isDisclaimerOpen, setIsDisclaimerOpen] = useState(false);
    const [isStatisticsOpen, setIsStatisticsOpen] = useState(false);
    const [isModelInfoOpen, setIsModelInfoOpen] = useState(false);
    const [pendingImportText, setPendingImportText] = useState<string | null>(null);

    const languageOptions = useMemo(() => ([
        { value: 'zh', label: '简体中文', icon: <img src={flagCN} alt="CN" className="w-5 h-5 rounded-sm object-contain" /> },
        { value: 'zh-TW', label: '正體中文（台湾）', icon: <img src={flagTW} alt="TW" className="w-5 h-5 rounded-sm object-contain" /> },
        { value: 'yue', label: '廣東話', icon: <img src={flagHK} alt="HK" className="w-5 h-5 rounded-sm object-contain" /> },
        { value: 'en', label: 'English', icon: <img src={flagUS} alt="US" className="w-5 h-5 rounded-sm object-contain" /> },
        { value: 'ja', label: '日本語', icon: <img src={flagJP} alt="JP" className="w-5 h-5 rounded-sm object-contain" /> },
        { value: 'ru', label: 'Русский', icon: <img src={flagRU} alt="RU" className="w-5 h-5 rounded-sm object-contain" /> },
        { value: 'uk', label: 'Українська', icon: <img src={flagUA} alt="UA" className="w-5 h-5 rounded-sm object-contain" /> },
    ]), []);

    const sanitizeImportedEvents = (raw: unknown): DoseEvent[] => {
        if (!Array.isArray(raw)) {
            throw new Error('Invalid format');
        }

        return raw
            .map((entry): DoseEvent | null => {
                if (!isRecord(entry)) return null;

                const timeNum = toNumber(entry.timeH);
                if (timeNum === null) return null;

                const doseNum = toNumber(entry.doseMG) ?? 0;
                const extras = isRecord(entry.extras) ? entry.extras : {};

                return {
                    id: typeof entry.id === 'string' ? entry.id : uuidv4(),
                    route: entry.route as DoseEvent['route'],
                    timeH: timeNum,
                    doseMG: doseNum,
                    ester: entry.ester as DoseEvent['ester'],
                    extras: extras as DoseEvent['extras'],
                };
            })
            .filter((entry): entry is DoseEvent => entry !== null);
    };

    const sanitizeImportedLabResults = (raw: unknown): LabResult[] => {
        if (!Array.isArray(raw)) {
            return [];
        }

        return raw
            .map((entry): LabResult | null => {
                if (!isRecord(entry)) return null;

                const timeNum = toNumber(entry.timeH);
                const valueNum = toNumber(entry.concValue);
                if (timeNum === null || valueNum === null) return null;

                const unit = entry.unit === 'pg/ml' || entry.unit === 'pmol/l' ? entry.unit : 'pmol/l';

                return {
                    id: typeof entry.id === 'string' ? entry.id : uuidv4(),
                    timeH: timeNum,
                    concValue: valueNum,
                    unit,
                };
            })
            .filter((entry): entry is LabResult => entry !== null);
    };

    const processImportedData = (parsed: unknown): boolean => {
        try {
            let newEvents: DoseEvent[] = [];
            let newWeight: number | undefined;
            let newLabResults: LabResult[] = [];

            if (Array.isArray(parsed)) {
                newEvents = sanitizeImportedEvents(parsed);
            } else if (isRecord(parsed)) {
                if (Array.isArray(parsed.events)) {
                    newEvents = sanitizeImportedEvents(parsed.events);
                }
                const importedWeight = toNumber(parsed.weight);
                if (importedWeight !== null && importedWeight > 0) {
                    newWeight = importedWeight;
                }
                if (Array.isArray(parsed.labResults)) {
                    newLabResults = sanitizeImportedLabResults(parsed.labResults);
                }
            }

            if (!newEvents.length && newWeight === undefined && !newLabResults.length) {
                throw new Error('No valid entries');
            }

            const nextEvents = newEvents.length > 0 ? newEvents : events;
            const nextWeight = newWeight !== undefined ? newWeight : weight;
            const nextLabResults = newLabResults;

            if (newEvents.length > 0) {
                setEvents(newEvents);
                localStorage.setItem('hrt-events', JSON.stringify(newEvents));
            }

            if (newWeight !== undefined) {
                setWeight(newWeight);
                localStorage.setItem('hrt-weight', newWeight.toString());
            }

            setLabResults(newLabResults);
            localStorage.setItem('hrt-lab-results', JSON.stringify(newLabResults));

            const lastModified = new Date().toISOString();
            localStorage.setItem('hrt-last-modified', lastModified);
            const langValue = localStorage.getItem('hrt-lang') || lang;
            const dataHash = computeDataHash({
                events: nextEvents,
                weight: nextWeight,
                labResults: nextLabResults,
                lang: langValue,
            });
            localStorage.setItem('hrt-data-hash', dataHash);
            window.dispatchEvent(new CustomEvent('hrt-local-data-updated', { detail: { key: 'hrt-import', lastModified } }));

            showDialog('alert', t('drawer.import_success'));
            return true;
        } catch (error) {
            console.error(error);
            showDialog('alert', t('drawer.import_error'));
            return false;
        }
    };

    const importEventsFromJson = async (text: string): Promise<boolean> => {
        try {
            const parsed: unknown = JSON.parse(text);
            const confirmKey = (isAuthenticated && !isAuthLoading) ? 'import.overwrite_confirm' : 'import.overwrite_confirm_local';
            const confirmation = await showDialog('confirm', t(confirmKey));
            if (confirmation !== 'confirm') {
                return false;
            }

            if (
                isRecord(parsed) &&
                Boolean(parsed.encrypted) &&
                typeof parsed.iv === 'string' &&
                typeof parsed.salt === 'string' &&
                typeof parsed.data === 'string'
            ) {
                setPendingImportText(text);
                setIsPasswordInputOpen(true);
                return true;
            }

            return processImportedData(parsed);
        } catch (error) {
            console.error(error);
            showDialog('alert', t('drawer.import_error'));
            return false;
        }
    };

    const handlePasswordSubmit = async (passwordInput: string) => {
        if (!pendingImportText) return;

        const decrypted = await decryptData(pendingImportText, passwordInput);
        if (!decrypted) {
            showDialog('alert', t('import.decrypt_error'));
            return;
        }

        setIsPasswordInputOpen(false);
        setPendingImportText(null);

        try {
            const parsed: unknown = JSON.parse(decrypted);
            processImportedData(parsed);
        } catch (error) {
            console.error(error);
            showDialog('alert', t('import.decrypt_error'));
        }
    };

    const handleQuickExport = () => {
        if (events.length === 0 && labResults.length === 0) {
            showDialog('alert', t('drawer.empty_export'));
            return;
        }

        const exportData = {
            meta: { version: 1, exportedAt: new Date().toISOString() },
            weight,
            events,
            labResults,
        };

        navigator.clipboard.writeText(JSON.stringify(exportData, null, 2)).then(() => {
            showDialog('alert', t('drawer.export_copied'));
        }).catch((error) => {
            console.error('Failed to copy:', error);
        });
    };

    const downloadFile = (data: string, filename: string) => {
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    };

    const handleExportConfirm = async (encrypt: boolean) => {
        setIsExportModalOpen(false);

        const exportData = {
            meta: { version: 1, exportedAt: new Date().toISOString() },
            weight,
            events,
            labResults,
        };
        const json = JSON.stringify(exportData, null, 2);

        if (encrypt) {
            const { data, password } = await encryptData(json);
            setGeneratedPassword(password);
            setIsPasswordDisplayOpen(true);
            downloadFile(data, `hrt-dosages-encrypted-${new Date().toISOString().split('T')[0]}.json`);
            return;
        }

        downloadFile(json, `hrt-dosages-${new Date().toISOString().split('T')[0]}.json`);
    };

    const handleClearAllEvents = () => {
        if (!events.length) return;

        showDialog('confirm', t('drawer.clear_confirm'), () => {
            setEvents([]);
            localStorage.setItem('hrt-events', JSON.stringify([]));
            const lastModified = new Date().toISOString();
            localStorage.setItem('hrt-last-modified', lastModified);
            const langValue = localStorage.getItem('hrt-lang') || lang;
            const dataHash = computeDataHash({
                events: [],
                weight,
                labResults,
                lang: langValue,
            });
            localStorage.setItem('hrt-data-hash', dataHash);
            window.dispatchEvent(new CustomEvent('hrt-local-data-updated', { detail: { key: 'hrt-events', lastModified } }));
        });
    };

    return (
        <div className="min-h-full px-4 py-6 md:px-6">
            <div className="mx-auto w-full max-w-2xl space-y-6">
                <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                    <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
                        <SettingsIcon size={24} className="text-pink-500" />
                        {t('nav.settings') || 'Settings'}
                    </h1>
                </div>

                <section className="space-y-2">
                    <h2 className="px-1 text-xs font-bold uppercase tracking-wider text-gray-400">
                        {t('settings.group.general') || 'General'}
                    </h2>
                    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                        <div className="mb-3 flex items-start gap-3">
                            <Languages className="text-blue-500" size={20} />
                            <div>
                                <p className="text-sm font-bold text-gray-900">{t('drawer.lang')}</p>
                                <p className="text-xs text-gray-500">{t('drawer.lang_hint')}</p>
                            </div>
                            <div className="ml-auto text-xs font-bold text-gray-500">{lang.toUpperCase()}</div>
                        </div>
                        <CustomSelect
                            value={lang}
                            onChange={(value) => setLang(value as Lang)}
                            options={languageOptions}
                        />
                    </div>
                </section>

                <section className="space-y-2">
                    <h2 className="px-1 text-xs font-bold uppercase tracking-wider text-gray-400">
                        {t('settings.group.data') || 'Data Management'}
                    </h2>
                    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm divide-y divide-gray-100">
                        <button
                            onClick={() => setIsImportModalOpen(true)}
                            className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-teal-50"
                        >
                            <Upload className="text-teal-500" size={20} />
                            <div>
                                <p className="text-sm font-bold text-gray-900">{t('import.title')}</p>
                                <p className="text-xs text-gray-500">{t('drawer.import_hint')}</p>
                            </div>
                        </button>

                        <div className="h-px bg-white/70" />

                        <button
                            onClick={() => {
                                if (events.length === 0 && labResults.length === 0) {
                                    showDialog('alert', t('drawer.empty_export'));
                                    return;
                                }
                                setIsExportModalOpen(true);
                            }}
                            className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-pink-50"
                        >
                            <Download className="text-pink-500" size={20} />
                            <div>
                                <p className="text-sm font-bold text-gray-900">{t('export.title')}</p>
                                <p className="text-xs text-gray-500">{t('drawer.save_hint')}</p>
                            </div>
                        </button>


                        <button
                            onClick={handleQuickExport}
                            className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-blue-50"
                        >
                            <Copy className="text-blue-500" size={20} />
                            <div>
                                <p className="text-sm font-bold text-gray-900">{t('drawer.export_quick')}</p>
                                <p className="text-xs text-gray-500">{t('drawer.export_quick_hint')}</p>
                            </div>
                        </button>

                        <button
                            onClick={handleClearAllEvents}
                            disabled={!events.length}
                            className={`flex w-full items-center gap-3 px-4 py-4 text-left transition ${
                                events.length ? 'hover:bg-red-50' : 'cursor-not-allowed bg-gray-50 opacity-60'
                            }`}
                        >
                            <Trash2 className="text-red-500" size={20} />
                            <div>
                                <p className="text-sm font-bold text-gray-900">{t('drawer.clear')}</p>
                                <p className="text-xs text-gray-500">{t('drawer.clear_confirm')}</p>
                            </div>
                        </button>
                    </div>
                </section>

                <section className="space-y-2">
                    <h2 className="px-1 text-xs font-bold uppercase tracking-wider text-gray-400">
                        {t('settings.group.about') || 'About'}
                    </h2>
                    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm divide-y divide-gray-100">
                        <button
                            onClick={() => setIsModelInfoOpen(true)}
                            className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-purple-50"
                        >
                            <Info className="text-purple-500" size={20} />
                            <div>
                                <p className="text-sm font-bold text-gray-900">{t('drawer.model_title')}</p>
                                <p className="text-xs text-gray-500">{t('drawer.model_desc')}</p>
                            </div>
                        </button>

                        <button
                            onClick={() => {
                                showDialog('confirm', t('drawer.github_confirm'), () => {
                                    window.open('https://github.com/TransmtfTeam/Transmtf-HRT-Tracker', '_blank');
                                });
                            }}
                            className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-gray-50"
                        >
                            <Github className="text-gray-700" size={20} />
                            <div>
                                <p className="text-sm font-bold text-gray-900">{t('drawer.github')}</p>
                                <p className="text-xs text-gray-500">{t('drawer.github_desc')}</p>
                            </div>
                        </button>

                        <button
                            onClick={() => {
                                showDialog('confirm', t('drawer.contact_confirm'), () => {
                                    window.open('https://x.com/axzamyzed', '_blank');
                                });
                            }}
                            className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-gray-50"
                        >
                            <AtSign className="text-gray-700" size={20} />
                            <div>
                                <p className="text-sm font-bold text-gray-900">{t('drawer.contact')}</p>
                                <p className="text-xs text-gray-500">{t('drawer.contact_desc')}</p>
                            </div>
                        </button>

                        <button
                            onClick={() => setIsStatisticsOpen(true)}
                            className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-blue-50"
                        >
                            <BarChart2 className="text-blue-500" size={20} />
                            <div>
                                <p className="text-sm font-bold text-gray-900">{t('statistics.title')}</p>
                                <p className="text-xs text-gray-500">{t('statistics.desc')}</p>
                            </div>
                        </button>

                        <button
                            onClick={() => setIsDisclaimerOpen(true)}
                            className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-amber-50"
                        >
                            <AlertTriangle className="text-amber-500" size={20} />
                            <div>
                                <p className="text-sm font-bold text-gray-900">{t('drawer.disclaimer')}</p>
                                <p className="text-xs text-gray-500">{t('drawer.disclaimer_desc')}</p>
                            </div>
                        </button>
                    </div>
                </section>

                <div className="pb-4 pt-2 text-center">
                    <p className="text-xs font-medium text-gray-400">{APP_VERSION}</p>
                </div>
            </div>

            <ImportModal
                isOpen={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                onImportJson={importEventsFromJson}
            />

            <ExportModal
                isOpen={isExportModalOpen}
                onClose={() => setIsExportModalOpen(false)}
                onExport={handleExportConfirm}
                events={events}
                labResults={labResults}
                weight={weight}
            />

            <PasswordDisplayModal
                isOpen={isPasswordDisplayOpen}
                onClose={() => setIsPasswordDisplayOpen(false)}
                password={generatedPassword}
            />

            <PasswordInputModal
                isOpen={isPasswordInputOpen}
                onClose={() => setIsPasswordInputOpen(false)}
                onConfirm={handlePasswordSubmit}
            />

            <DisclaimerModal
                isOpen={isDisclaimerOpen}
                onClose={() => setIsDisclaimerOpen(false)}
            />

            <ModelInfoModal
                isOpen={isModelInfoOpen}
                onClose={() => setIsModelInfoOpen(false)}
            />

            <StatisticsModal
                isOpen={isStatisticsOpen}
                onClose={() => setIsStatisticsOpen(false)}
            />
        </div>
    );
};

export default SettingsPage;