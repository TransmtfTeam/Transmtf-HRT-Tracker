import React from 'react';
import { Delete } from 'lucide-react';

interface NumericKeypadProps {
  onNumberPress: (num: number) => void;
  onDelete: () => void;
  disabled?: boolean;
}

const btnBase: React.CSSProperties = {
  background: 'rgba(255,255,255,0.55)',
  backdropFilter: 'blur(12px) saturate(160%)',
  WebkitBackdropFilter: 'blur(12px) saturate(160%)',
  border: '1.5px solid rgba(255,255,255,0.75)',
  boxShadow: '0 2px 12px rgba(236,72,153,0.08), 0 1px 0 rgba(255,255,255,0.9) inset',
  borderRadius: '50%',
  color: 'rgba(20,10,40,0.82)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
  cursor: 'pointer',
  transition: 'all 0.12s ease',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  touchAction: 'manipulation',
};

const NumericKeypad: React.FC<NumericKeypadProps> = ({ onNumberPress, onDelete, disabled = false }) => {
  const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'delete'] as const;

  return (
    <div className="grid grid-cols-3 gap-3 sm:gap-4 max-w-[280px] sm:max-w-xs mx-auto px-2 sm:px-0">
      {numbers.map((item, index) => {
        if (item === null) {
          return <div key={index} />;
        }

        if (item === 'delete') {
          return (
            <button
              key={index}
              onClick={onDelete}
              disabled={disabled}
              aria-label="Delete"
              className="w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 disabled:opacity-40 disabled:cursor-not-allowed"
              style={btnBase}
              onMouseEnter={e => {
                if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.72)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.55)';
              }}
              onMouseDown={e => {
                if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.85)';
              }}
              onMouseUp={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.72)';
              }}
            >
              <Delete size={20} className="sm:w-6 sm:h-6" style={{ color: 'rgba(20,10,40,0.7)' }} strokeWidth={2.5} />
            </button>
          );
        }

        return (
          <button
            key={index}
            onClick={() => onNumberPress(item)}
            disabled={disabled}
            className="w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              ...btnBase,
              fontSize: 'clamp(1.25rem, 5vw, 1.75rem)',
              fontWeight: 300,
            }}
            onMouseEnter={e => {
              if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.72)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.55)';
            }}
            onMouseDown={e => {
              if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.85)';
            }}
            onMouseUp={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.72)';
            }}
          >
            {item}
          </button>
        );
      })}
    </div>
  );
};

export default NumericKeypad;
