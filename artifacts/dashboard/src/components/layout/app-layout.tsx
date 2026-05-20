import { Sidebar } from "./sidebar";
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
      <Sidebar />
      <main className="flex-1 md:ml-64 overflow-y-auto flex flex-col">
        {(title || actions) && (
          <header className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-border px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                {title && (
                  <h1 className="text-lg font-semibold text-foreground">{title}</h1>
                )}
                {subtitle && (
                  <p className="text-sm text-muted-foreground">{subtitle}</p>
                )}
              </div>
              {actions && <div className="flex items-center gap-2">{actions}</div>}
            </div>
          </header>
        )}
        <div className="flex-1 p-6">{children}</div>
      </main>
    </div>
  );
}
