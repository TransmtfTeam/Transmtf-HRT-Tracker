import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from '../contexts/LanguageContext';
import jsQR from 'jsqr';
import { X, QrCode, Activity, ImageIcon, Upload } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';

const ImportModal = ({ isOpen, onClose, onImportJson }: { isOpen: boolean; onClose: () => void; onImportJson: (text: string) => Promise<boolean> }) => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<'qr' | 'json'>('qr');
    const [text, setText] = useState("");
    const [errorMsg, setErrorMsg] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const qrFileInputRef = useRef<HTMLInputElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (isOpen) {
            setText("");
            setErrorMsg("");
            setActiveTab('qr');
        }
    }, [isOpen]);

    const handleJsonFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
            const content = reader.result as string;
            if (await onImportJson(content)) {
                onClose();
            }
        };
        reader.readAsText(file);
        e.target.value = "";
    };

    const handleTextImport = async () => {
        if (await onImportJson(text)) {
            onClose();
        }
    };

    const handleQrImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setErrorMsg('');
        const reader = new FileReader();
        reader.onload = () => {
            const img = new window.Image();
            img.onload = async () => {
                const canvas = canvasRef.current;
                const ctx = canvas?.getContext('2d');
                if (!canvas || !ctx) return;
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(imageData.data, canvas.width, canvas.height);
                if (code?.data) {
                    if (await onImportJson(code.data)) {
                        onClose();
                    }
                } else {
                    setErrorMsg(t('qr.error.decode'));
                }
            };
            img.onerror = () => setErrorMsg(t('qr.error.decode'));
            img.src = reader.result as string;
        };
        reader.readAsDataURL(file);
        e.target.value = "";
    };

    const dialogRef = useFocusTrap(isOpen, onClose);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center z-50 animate-in fade-in duration-200">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="import-modal-title"
                className="bg-white rounded-t-3xl md:rounded-3xl shadow-md shadow-gray-900/10 w-full max-w-lg md:max-w-2xl p-6 md:p-8 flex flex-col max-h-[90vh] animate-in slide-in-from-bottom duration-300 safe-area-pb"
            >
                <div className="flex justify-between items-center mb-6 shrink-0">
                    <h3 id="import-modal-title" className="text-xl font-semibold text-gray-900">{t('import.title')}</h3>
                    <button onClick={onClose} aria-label={t('btn.close')} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition">
                        <X size={20} className="text-gray-500" aria-hidden="true" />
                    </button>
                </div>

                <div className="flex p-1 bg-gray-100 rounded-xl mb-6 shrink-0">
                    <button
                        onClick={() => setActiveTab('qr')}
                        className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${activeTab === 'qr' ? 'bg-white text-gray-900' : 'text-gray-500'}`}
                    >
                        <QrCode size={16} />
                        QR Code
                    </button>
                    <button
                        onClick={() => setActiveTab('json')}
                        className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${activeTab === 'json' ? 'bg-white text-gray-900' : 'text-gray-500'}`}
                    >
                        <Activity size={16} />
                        JSON
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto min-h-0">
                    {activeTab === 'qr' && (
                        <div className="space-y-4">
                            <div className="p-8 border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center text-center hover:bg-gray-50 transition cursor-pointer" onClick={() => qrFileInputRef.current?.click()}>
                                <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mb-4">
                                    <ImageIcon size={32} />
                                </div>
                                <p className="text-sm font-bold text-gray-900">{t('qr.import.file')}</p>
                                <p className="text-xs text-gray-400 mt-1">{t('qr.upload.hint')}</p>
                            </div>
                            <input type="file" accept="image/*" ref={qrFileInputRef} onChange={handleQrImageUpload} className="hidden" />
                            
                            {errorMsg && (
                                <div role="alert" className="p-3 bg-red-50 text-red-500 text-xs font-bold rounded-xl text-center">
                                    {errorMsg}
                                </div>
                            )}
                            <canvas ref={canvasRef} className="hidden" />
                        </div>
                    )}

                    {activeTab === 'json' && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">{t('import.text')}</label>
                                <textarea
                                    className="w-full h-32 p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-pink-300 outline-none font-mono text-xs"
                                    placeholder={t('import.paste_hint')}
                                    value={text}
                                    onChange={e => setText(e.target.value)}
                                />
                                <button
                                    onClick={handleTextImport}
                                    disabled={!text.trim()}
                                    className="mt-2 w-full py-3 bg-gray-900 text-white font-bold rounded-xl hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
                                >
                                    {t('drawer.import')}
                                </button>
                            </div>

                            <div className="relative flex py-2 items-center">
                                <div className="flex-grow border-t border-gray-200"></div>
                                <span className="flex-shrink-0 mx-4 text-gray-400 text-xs uppercase font-bold">OR</span>
                                <div className="flex-grow border-t border-gray-200"></div>
                            </div>

                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="w-full py-3 border-2 border-dashed border-gray-300 text-gray-500 font-bold rounded-xl hover:border-pink-300 hover:bg-pink-50 hover:text-pink-500 transition flex items-center justify-center gap-2"
                            >
                                <Upload size={20} />
                                {t('import.file_btn')}
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="application/json"
                                className="hidden"
                                onChange={handleJsonFileChange}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ImportModal;
