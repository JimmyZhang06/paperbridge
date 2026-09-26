import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

export type SelectMenuOption = { value: string; label: string };

export function SelectMenu({ value, options, onChange, label, className = '', leadingIcon }: {
  value: string;
  options: SelectMenuOption[];
  onChange: (value: string) => void;
  label: string;
  className?: string;
  leadingIcon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selected = options.find(option => option.value === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  function choose(option: SelectMenuOption) {
    onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus();
  }

  return <div className={`select-menu ${className}`.trim()} ref={rootRef} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button ref={buttonRef} type="button" className="select-menu-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(current => !current)} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus());
      }
    }}>{leadingIcon}<span>{selected?.label || '选择一项'}</span><ChevronDown size={14} className={open ? 'select-menu-chevron is-open' : 'select-menu-chevron'} /></button>
    {open && <div className="select-menu-list" role="listbox" aria-label={`${label}选项`}>
      {options.map(option => <button key={option.value} type="button" role="option" aria-selected={option.value === value} className={`select-menu-option ${option.value === value ? 'selected' : ''}`} onClick={() => choose(option)} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const items = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') || [])];
          const currentIndex = items.indexOf(event.currentTarget);
          const nextIndex = event.key === 'ArrowDown' ? (currentIndex + 1) % items.length : (currentIndex - 1 + items.length) % items.length;
          items[nextIndex]?.focus();
        }
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(option); }
      }}><span>{option.label}</span>{option.value === value && <Check size={15} />}</button>)}
    </div>}
  </div>;
}
