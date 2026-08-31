import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import NavigationSidebar from "./NavigationSidebar";

export type CompactNavigationProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPath: string;
  onNavigate: (path: string) => void;
};

/** Tablet/mobile navigation regime backed by the same groups as desktop. */
export default function CompactNavigation({
  open,
  onOpenChange,
  currentPath,
  onNavigate,
}: CompactNavigationProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        data-compact-navigation
        className="w-[min(21rem,92vw)] gap-0 rounded-r-[var(--radius-dialog)] border-r border-sidebar-border bg-sidebar p-0 [&>button]:z-50"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Navigazione Ruffino Flow</SheetTitle>
          <SheetDescription>
            Scegli una destinazione del gestionale.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 [&_[data-nav-collapse]]:hidden">
          <NavigationSidebar
            currentPath={currentPath}
            collapsed={false}
            onNavigate={onNavigate}
            onCollapsedChange={() => onOpenChange(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
