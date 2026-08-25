import { NotificationItem, type NotificationItemData } from "./NotificationItem";

export function NotificationGroup({
  label,
  items,
  onOpen,
  onRead,
  onResolve,
}: {
  label: string;
  items: NotificationItemData[];
  onOpen: (item: NotificationItemData) => void;
  onRead: (item: NotificationItemData) => void;
  onResolve: (item: NotificationItemData) => void;
}) {
  const headingId = `notification-group-${label.replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={headingId}>
      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2.5">
        <h2 id={headingId} className="text-xs font-semibold uppercase text-muted-foreground">
          {label}
        </h2>
        <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>
      </div>
      {items.map(item => (
        <NotificationItem
          key={item.canonicalKey}
          item={item}
          onOpen={() => onOpen(item)}
          onRead={() => onRead(item)}
          onResolve={item.legacy ? undefined : () => onResolve(item)}
        />
      ))}
    </section>
  );
}
