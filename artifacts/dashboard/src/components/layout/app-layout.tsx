import { Sidebar } from "./sidebar";
import { GlobalSearch } from "@/components/global-search";
import { type ReactNode } from "react";

interface AppLayoutProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function AppLayout({ children, title, subtitle, actions }: AppLayoutProps) {
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <GlobalSearch />
      <Sidebar />
      <main className="flex-1 md:ml-64 overflow-y-auto flex flex-col">
        {(title || actions) && (
          <header className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-border px-4 md:px-6 py-3 md:py-4 pl-16 md:pl-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                {title && (
                  <h1 className="text-base md:text-lg font-semibold text-foreground truncate">{title}</h1>
                )}
                {subtitle && (
                  <p className="text-xs md:text-sm text-muted-foreground line-clamp-2 md:line-clamp-none">{subtitle}</p>
                )}
              </div>
              {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
            </div>
          </header>
        )}
        <div className={`flex-1 p-4 md:p-6 ${title || actions ? "" : "pt-16 md:pt-6"}`}>{children}</div>
      </main>
    </div>
  );
}
