import {
  type ButtonHTMLAttributes,
  Children,
  cloneElement,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Icon, type IconName } from "../icons";
export { Icon };
export type { IconName };
const cx = (...names: (string | undefined | false)[]) => names.filter(Boolean).join(" ");
export function Button({
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "link";
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        variant === "link" ? "link" : "btn",
        variant === "primary" && "pri",
        variant === "danger" && "ui-danger",
        className,
      )}
    />
  );
}
export function Tooltip({ label, children }: { label: string; children: ReactElement }) {
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({ left: 0, top: 0 }),
    anchor = useRef<HTMLSpanElement>(null),
    bubble = useRef<HTMLSpanElement>(null),
    id = useId(),
    child = children as ReactElement<{ "aria-describedby"?: string }>;
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect(),
        b = bubble.current?.getBoundingClientRect();
      if (!a || !b) return;
      setPosition({
        left: Math.max(16, Math.min(innerWidth - b.width - 16, a.left + (a.width - b.width) / 2)),
        top:
          a.bottom + b.height + 6 <= innerHeight ? a.bottom + 6 : Math.max(6, a.top - b.height - 6),
      });
    };
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("keydown", dismiss);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("keydown", dismiss);
    };
  }, [open, label]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: wrapper only observes child focus/hover; the child button owns interaction
    <span
      role="presentation"
      className="ui-tip"
      ref={anchor}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {cloneElement(child, {
        "aria-describedby":
          [child.props["aria-describedby"], open ? id : null].filter(Boolean).join(" ") ||
          undefined,
      })}
      <span
        ref={bubble}
        id={id}
        role="tooltip"
        className="ui-tooltip-bubble"
        hidden={!open}
        style={position}
      >
        {label}
      </span>
    </span>
  );
}
export function IconButton({
  label,
  icon,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  icon: IconName;
  variant?: "primary" | "secondary";
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <Tooltip label={label}>
      <Button
        {...props}
        aria-label={label}
        title={label}
        className={cx("ui-icon-button", props.className)}
      >
        <Icon name={icon} />
      </Button>
    </Tooltip>
  );
}
export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx("input", props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx("select", props.className)} />;
}
export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx("input", props.className)} />;
}
export function Field({
  label,
  children,
  error,
  hint,
  full = false,
  optional = false,
}: {
  label: string;
  children: ReactElement;
  error?: string;
  hint?: string;
  full?: boolean;
  optional?: boolean;
}) {
  const uid = useId(),
    child = Children.only(children) as ReactElement<{
      id?: string;
      required?: boolean;
      "aria-describedby"?: string;
      "aria-labelledby"?: string;
      "aria-invalid"?: boolean;
    }>,
    id = child.props.id ?? uid,
    description =
      [child.props["aria-describedby"], hint ? `${id}-hint` : null, error ? `${id}-error` : null]
        .filter(Boolean)
        .join(" ") || undefined;
  return (
    <label className={cx("ui-field", full && "full")} htmlFor={id}>
      <span>
        <span id={`${id}-label`}>{label}</span>
        {child.props.required && (
          <span className="ui-required" aria-hidden="true">
            {" "}
            *
          </span>
        )}
        {optional && <span className="muted"> · tùy chọn</span>}
      </span>
      {cloneElement(child, {
        id,
        "aria-labelledby": `${id}-label`,
        "aria-describedby": description,
        "aria-invalid": !!error || child.props["aria-invalid"],
      })}
      {hint && (
        <small id={`${id}-hint`} className="muted">
          {hint}
        </small>
      )}
      {error && (
        <small id={`${id}-error`} className="ui-field-error">
          {error}
        </small>
      )}
    </label>
  );
}
export function Choice({
  label,
  type = "checkbox",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
  type?: "checkbox" | "radio";
}) {
  return (
    <label className="opt">
      <input {...props} type={type} />
      {label}
    </label>
  );
}
export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section {...props} className={cx("card", className)} />;
}
export function SectionHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card-h">
      <h3>{title}</h3>
      {children && <div className="ui-heading-actions">{children}</div>}
    </div>
  );
}
export function Badge({
  tone = "muted",
  children,
}: {
  tone?: "good" | "warn" | "bad" | "primary" | "gold" | "friend" | "muted";
  children: ReactNode;
}) {
  const tones = {
    primary: "pri",
    muted: "mute",
    good: "good",
    warn: "warn",
    bad: "bad",
    gold: "gold",
    friend: "friend",
  };
  return <span className={`pill p-${tones[tone]}`}>{children}</span>;
}
export function Feedback({
  tone = "info",
  children,
}: {
  tone?: "info" | "success" | "error" | "warning";
  children: ReactNode;
}) {
  const cls = `ui-feedback ui-feedback-${tone}`;
  return tone === "info" || tone === "success" ? (
    <output className={cls}>{children}</output>
  ) : (
    <div className={cls} role={tone === "error" ? "alert" : "note"}>
      {children}
    </div>
  );
}
export function EmptyState({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <Card className="empty">
      <p>{message}</p>
      {children}
    </Card>
  );
}
export function Loading({ children = "Đang tải…" }: { children?: ReactNode }) {
  return <output className="ui-loading">{children}</output>;
}
export function KeyValueList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="kv ui-kv">
      {items.map((item) => (
        <div className="ui-kv-row" key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
export function StatCard({
  label,
  value,
  compact = false,
  unavailable = false,
}: {
  label: string;
  value: ReactNode;
  compact?: boolean;
  unavailable?: boolean;
}) {
  return (
    <section
      className={cx(compact ? "ui-stat" : "card kpi", unavailable && "ui-stat-unavailable")}
      aria-label={`${label}: ${unavailable ? "Chưa có số liệu" : value}`}
    >
      <div className="lbl">{label}</div>
      <div className="big num" title={unavailable ? "Chưa có số liệu" : undefined}>
        {value}
      </div>
    </section>
  );
}
export function Stats({ children }: { children: ReactNode }) {
  return <div className="ui-stats">{children}</div>;
}
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}
export function TableFrame({ children, label }: { children: ReactNode; label: string }) {
  return (
    // Keyboard users need to scroll this bounded table independently of the page.
    // biome-ignore lint/a11y/noNoninteractiveTabindex: named scroll region must be keyboard reachable
    <section className="tbl-wrap" aria-label={label} tabIndex={0}>
      {children}
    </section>
  );
}
export function PaginationControl({ loading, onMore }: { loading: boolean; onMore: () => void }) {
  return (
    <div className="ui-pagination">
      <Button disabled={loading} onClick={onMore}>
        {loading ? "Đang tải…" : "Xem thêm"}
      </Button>
    </div>
  );
}
export function Tabs({
  id,
  items,
  value,
  onChange,
}: {
  id: string;
  items: { id: string; label: string; disabled?: boolean }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs" role="tablist" aria-label="Các mục">
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          id={`${id}-tab-${item.id}`}
          aria-controls={`${id}-panel-${item.id}`}
          aria-selected={value === item.id}
          disabled={item.disabled}
          tabIndex={value === item.id ? 0 : -1}
          className={cx("tab", value === item.id && "on")}
          onClick={() => onChange(item.id)}
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
            e.preventDefault();
            const enabled = items.filter((x) => !x.disabled),
              at = enabled.findIndex((x) => x.id === item.id),
              next =
                e.key === "Home"
                  ? enabled[0]
                  : e.key === "End"
                    ? enabled.at(-1)
                    : enabled[
                        (at + (e.key === "ArrowRight" ? 1 : enabled.length - 1)) % enabled.length
                      ];
            if (next) {
              onChange(next.id);
              const siblings = Array.from(
                e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]") ??
                  [],
              );
              siblings[items.findIndex((x) => x.id === next.id)]?.focus();
            }
          }}
          data-tab-index={index}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
export function Modal({
  open,
  title,
  children,
  onClose,
  locked = false,
  kind = "modal",
  dialogRef,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  locked?: boolean;
  kind?: "modal" | "drawer";
  dialogRef?: RefObject<HTMLDialogElement | null>;
}) {
  const ownRef = useRef<HTMLDialogElement>(null),
    ref = dialogRef ?? ownRef,
    trigger = useRef<HTMLElement | null>(null),
    id = useId();
  useEffect(() => {
    if (open) {
      if (!ref.current?.open) {
        trigger.current = document.activeElement as HTMLElement;
        ref.current?.showModal();
      }
      const target =
        ref.current?.querySelector<HTMLElement>(
          "input:not(:disabled),select:not(:disabled),textarea:not(:disabled)",
        ) ?? ref.current?.querySelector<HTMLElement>("button:not(:disabled)");
      target?.focus();
    } else if (ref.current?.open) {
      ref.current.close();
      trigger.current?.focus();
    }
  }, [open, title]);
  return (
    <dialog
      ref={ref}
      className={cx(kind, "ui-dialog")}
      aria-labelledby={id}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const targets = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex='-1'])",
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = targets[0],
          last = targets.at(-1);
        if (
          first &&
          last &&
          (event.shiftKey ? document.activeElement === first : document.activeElement === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        if (!locked) onClose();
      }}
    >
      <div className="ui-dialog-heading">
        <h3 id={id}>{title}</h3>
        <Button className="x" aria-label="Đóng" title="Đóng" disabled={locked} onClick={onClose}>
          <Icon name="x" />
        </Button>
      </div>
      {children}
    </dialog>
  );
}
export function Drawer(props: Omit<Parameters<typeof Modal>[0], "kind">) {
  return <Modal {...props} kind="drawer" />;
}
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="ui-dialog-actions">{children}</div>;
}
export function Brand() {
  return (
    <div className="brand">
      <span className="logo">
        <Icon name="cross" />
      </span>
      <b>QLHT</b>
    </div>
  );
}
export function AuthCard({
  title,
  children,
  headingRef,
}: {
  title: string;
  children: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <main className="ui-auth-layout">
      <Card className="ui-auth-card">
        <Brand />
        <h1 ref={headingRef} tabIndex={-1}>
          {title}
        </h1>
        {children}
      </Card>
    </main>
  );
}
export function AppShell({
  title,
  context,
  activeId,
  identity,
  items,
  onLogout,
  busy,
  children,
}: {
  title: string;
  context?: string;
  activeId: string;
  identity: { displayName: string; email: string };
  items: {
    id: string;
    label: string;
    description?: string;
    icon: IconName;
    disabled?: boolean;
    onSelect: () => void;
  }[];
  onLogout: () => void;
  busy: boolean;
  children: ReactNode;
}) {
  const [nav, setNav] = useState(false),
    menuRef = useRef<HTMLButtonElement>(null),
    firstRef = useRef<HTMLButtonElement>(null),
    wasOpen = useRef(false),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [title, context]);
  useEffect(() => {
    const media = matchMedia("(max-width: 900px)"),
      change = () => {
        if (!media.matches) setNav(false);
      };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!nav) {
      if (wasOpen.current) menuRef.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    firstRef.current?.focus();
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNav(false);
      if (e.key === "Tab") {
        const targets = Array.from(
          document.querySelectorAll<HTMLButtonElement>(".side button:not(:disabled),.ui-nav-close"),
        );
        const at = targets.indexOf(document.activeElement as HTMLButtonElement);
        if (targets.length && (e.shiftKey ? at <= 0 : at === targets.length - 1)) {
          e.preventDefault();
          targets[e.shiftKey ? targets.length - 1 : 0]?.focus();
        }
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [nav]);
  return (
    <div className="app">
      {nav && (
        <button
          type="button"
          className="scrim ui-nav-close"
          aria-label="Đóng điều hướng"
          onClick={() => setNav(false)}
        />
      )}
      <aside className={cx("side", nav && "open")}>
        <Brand />
        <nav aria-label="Điều hướng">
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              ref={index === 0 ? firstRef : undefined}
              className={cx("nav-a", item.id === activeId && "on")}
              aria-current={item.id === activeId ? "page" : undefined}
              aria-label={[item.label, item.description].filter(Boolean).join(" — ")}
              disabled={item.disabled}
              onClick={() => {
                setNav(false);
                item.onSelect();
              }}
            >
              <Icon name={item.icon} />
              <span className="ui-nav-copy">
                <span className="ui-nav-label">{item.label}</span>
                {item.description && (
                  <small className="ui-nav-description">{item.description}</small>
                )}
              </span>
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <b>{identity.displayName}</b>
          <p className="small">{identity.email}</p>
        </div>
      </aside>
      <main className="main" inert={nav}>
        <header className="top">
          <Button
            className="menu-btn"
            ref={menuRef}
            aria-label="Mở điều hướng"
            onClick={() => setNav((x) => !x)}
          >
            <Icon name="menu" />
          </Button>
          <div className="ui-page-heading">
            <h1 ref={heading} tabIndex={-1}>
              {title}
            </h1>
            {context && <div className="sub">{context}</div>}
          </div>
          <span className="sp" />
          <IconButton label="Đăng xuất" icon="logout" disabled={busy} onClick={onLogout} />
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
