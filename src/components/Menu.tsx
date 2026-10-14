import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, Ellipsis } from 'lucide-react';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  separatorBefore?: boolean;
  hidden?: boolean;
  disabled?: boolean;
  /** Makes the item one of a set of choices, ticked when true. */
  checked?: boolean;
  /** Starts a labelled group, e.g. one set of choices. */
  heading?: string;
}

/** Items split where a heading starts a group. */
function groupItems(items: MenuItem[]) {
  const groups: { heading?: string; items: MenuItem[] }[] = [];
  for (const item of items) {
    if (item.heading || !groups.length) groups.push({ heading: item.heading, items: [] });
    groups.at(-1)!.items.push(item);
  }
  return groups;
}

export function MenuButton({
  items,
  label = 'More actions',
  icon = <Ellipsis size={18} />,
  align = 'right',
  className = 'icon-btn',
  disabled,
}: {
  items: MenuItem[];
  label?: string;
  icon?: ReactNode;
  /** Which edge of the button the menu lines up with. */
  align?: 'left' | 'right';
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const buttons = () => Array.from(anchor.current?.querySelectorAll<HTMLButtonElement>('.menu button:not(:disabled)') ?? []);
    buttons()[0]?.focus();

    const onPointerDown = (e: PointerEvent) => {
      if (!anchor.current?.contains(e.target as Node)) setOpen(false);
    };
    // Capture phase so Escape closes the menu without also triggering view-level shortcuts.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const list = buttons();
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
        list[next]?.focus();
      } else if (e.key === 'Tab') {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  return (
    <div className="menu-anchor" ref={anchor}>
      <button
        ref={trigger}
        type="button"
        className={className}
        disabled={disabled}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {icon}
      </button>
      {open && (
        <div className={align === 'left' ? 'menu menu-left' : 'menu'} role="menu" id={menuId}>
          {groupItems(items.filter((item) => !item.hidden)).map((group, g) => {
            const buttons = group.items.map((item) => (
              <Fragment key={item.label}>
                {item.separatorBefore && <hr />}
                <button
                  type="button"
                  role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                  aria-checked={item.checked}
                  className={item.danger ? 'danger' : undefined}
                  disabled={item.disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  {item.checked === undefined ? item.icon : <Check size={15} className={item.checked ? undefined : 'invisible'} />}
                  {item.label}
                </button>
              </Fragment>
            ));
            if (!group.heading) return <Fragment key={g}>{buttons}</Fragment>;
            const headingId = `${menuId}-${g}`;
            return (
              <div key={g} role="group" aria-labelledby={headingId}>
                {g > 0 && <hr />}
                <div className="menu-heading" id={headingId}>
                  {group.heading}
                </div>
                {buttons}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
