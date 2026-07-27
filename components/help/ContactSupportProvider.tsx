"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import ContactSupportModal from "./ContactSupportModal";

export interface ContactSupportContext {
  tab?: string;
  projectId?: string;
  productName?: string;
}

interface OpenOptions {
  prefillTopic?: string;
  prefillMessage?: string;
  context?: ContactSupportContext;
}

interface ContactSupportApi {
  open: (opts?: OpenOptions) => void;
}

const Ctx = createContext<ContactSupportApi | null>(null);

// A single globally-mounted modal (see components/layout/Shell.tsx) that
// ANY component can trigger via useContactSupport().open() — each caller
// passes whatever page-specific context it actually has (project id/tab on
// a project page, nothing extra from the /help page's own triggers), so
// "current route/tab/project" auto-attachment (Part 1.3) is accurate
// without any global route-tracking machinery.
export function ContactSupportProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [opts, setOpts] = useState<OpenOptions>({});

  const open = useCallback((next?: OpenOptions) => {
    setOpts(next || {});
    setIsOpen(true);
  }, []);

  const api = useMemo(() => ({ open }), [open]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <ContactSupportModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        prefillTopic={opts.prefillTopic}
        prefillMessage={opts.prefillMessage}
        extraContext={opts.context}
      />
    </Ctx.Provider>
  );
}

export function useContactSupport(): ContactSupportApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useContactSupport must be used within ContactSupportProvider");
  return ctx;
}
