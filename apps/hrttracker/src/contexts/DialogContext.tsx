import React, { createContext, useContext, useState, useCallback } from 'react';
import { useTranslation } from './LanguageContext';
import { useFocusTrap } from '../hooks/useFocusTrap';

type DialogType = 'alert' | 'confirm';

interface DialogOptions {
  confirmText?: string;
  cancelText?: string;
  thirdOption?: string; // For three-button dialogs
}

interface DialogContextType {
  showDialog: (type: DialogType, message: string, options?: DialogOptions | (() => void)) => Promise<'confirm' | 'cancel' | 'third'>;
}

const DialogContext = createContext<DialogContextType | null>(null);

export const useDialog = () => {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be used within DialogProvider");
  return ctx;
};

export const DialogProvider = ({ children }: { children: React.ReactNode }) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState<DialogType>('alert');
  const [message, setMessage] = useState("");
  const [options, setOptions] = useState<DialogOptions>({});
  const [resolver, setResolver] = useState<((value: 'confirm' | 'cancel' | 'third') => void) | null>(null);

  const showDialog = useCallback((
    type: DialogType,
    message: string,
    opts?: DialogOptions | (() => void)
  ): Promise<'confirm' | 'cancel' | 'third'> => {
    // Support old callback API
    if (typeof opts === 'function') {
      const onConfirm = opts;
      setType(type);
      setMessage(message);
      setOptions({});
      setIsOpen(true);
      return new Promise((resolve) => {
        setResolver(() => (value: 'confirm' | 'cancel' | 'third') => {
          if (value === 'confirm') onConfirm();
          resolve(value);
        });
      });
    }

    // New Promise API
    setType(type);
    setMessage(message);
    setOptions(opts || {});
    setIsOpen(true);

    return new Promise((resolve) => {
      setResolver(() => resolve);
    });
  }, []);

  const handleChoice = (choice: 'confirm' | 'cancel' | 'third') => {
    if (resolver) resolver(choice);
    setIsOpen(false);
    setResolver(null);
  };

  const dialogRef = useFocusTrap(isOpen, () => handleChoice(type === 'alert' ? 'confirm' : 'cancel'));

  return (
    <DialogContext.Provider value={{ showDialog }}>
      {children}
      {isOpen && (
        <div
          className="fixed inset-0 flex items-center justify-center z-[100] p-5"
          style={{
            animation: 'dialogFadeIn 0.18s ease-out forwards',
            background: 'rgba(0, 0, 0, 0.35)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
          }}
        >
          <style>{`
            @keyframes dialogFadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes dialogScaleIn { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: scale(1); } }
          `}</style>
          <div className="w-full max-w-sm" style={{ animation: 'dialogScaleIn 0.2s cubic-bezier(0.34,1.56,0.64,1) forwards' }}>
            <div
              ref={dialogRef}
              role={type === 'alert' ? 'alertdialog' : 'dialog'}
              aria-modal="true"
              aria-labelledby="dialog-title"
              aria-describedby="dialog-msg"
              style={{
                background: 'rgba(255, 255, 255, 0.92)',
                backdropFilter: 'blur(24px) saturate(180%)',
                WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                border: '1px solid rgba(255, 255, 255, 0.7)',
                boxShadow: '0 24px 64px rgba(0,0,0,0.14), 0 1px 0 rgba(255,255,255,0.9) inset',
                borderRadius: '24px',
                padding: '24px',
              }}
            >
              <h3 id="dialog-title" className="text-base font-bold text-gray-900 mb-1.5">
                {type === 'confirm' ? t('dialog.confirm_title') : t('dialog.alert_title')}
              </h3>
              <p id="dialog-msg" className="text-gray-500 mb-5 leading-relaxed text-sm">{message}</p>

              {/* Alert: single full-width button */}
              {type === 'alert' && (
                <button
                  onClick={() => handleChoice('confirm')}
                  style={{
                    width: '100%',
                    padding: '13px',
                    borderRadius: '14px',
                    background: 'linear-gradient(135deg, #f9a8d4 0%, #ec4899 100%)',
                    border: 'none',
                    color: 'white',
                    fontWeight: 700,
                    fontSize: '14px',
                    cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(236,72,153,0.25)',
                  }}
                >
                  {options.confirmText || t('btn.ok')}
                </button>
              )}

              {/* Confirm: side-by-side cancel + confirm */}
              {type === 'confirm' && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleChoice('cancel')}
                    style={{
                      flex: 1,
                      padding: '13px',
                      borderRadius: '14px',
                      background: 'rgba(0,0,0,0.06)',
                      border: 'none',
                      color: '#374151',
                      fontWeight: 600,
                      fontSize: '14px',
                      cursor: 'pointer',
                    }}
                  >
                    {options.cancelText || t('btn.cancel')}
                  </button>
                  <button
                    onClick={() => handleChoice('confirm')}
                    style={{
                      flex: 1,
                      padding: '13px',
                      borderRadius: '14px',
                      background: 'linear-gradient(135deg, #f9a8d4 0%, #ec4899 100%)',
                      border: 'none',
                      color: 'white',
                      fontWeight: 700,
                      fontSize: '14px',
                      cursor: 'pointer',
                      boxShadow: '0 4px 14px rgba(236,72,153,0.25)',
                    }}
                  >
                    {options.confirmText || t('btn.ok')}
                  </button>
                </div>
              )}

              {/* Third option */}
              {options.thirdOption && (
                <button
                  onClick={() => handleChoice('third')}
                  style={{
                    width: '100%',
                    marginTop: '8px',
                    padding: '13px',
                    borderRadius: '14px',
                    background: 'rgba(0,0,0,0.04)',
                    border: '1px solid rgba(0,0,0,0.07)',
                    color: '#6b7280',
                    fontWeight: 500,
                    fontSize: '14px',
                    cursor: 'pointer',
                  }}
                >
                  {options.thirdOption}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
};
