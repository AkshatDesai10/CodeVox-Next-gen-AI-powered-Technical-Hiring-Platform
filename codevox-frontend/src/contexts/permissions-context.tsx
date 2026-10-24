'use client';

import React, { createContext, useContext, useMemo } from 'react';
import { useSession } from 'next-auth/react';

export interface PermissionsContextValue {
  permissions: string[];
  isLoading: boolean;
  can: (permission: string) => boolean;
  canAny: (permissions: string[]) => boolean;
  canAll: (permissions: string[]) => boolean;
}

const PermissionsContext = createContext<PermissionsContextValue>({
  permissions: [],
  isLoading: false,
  can: () => true,
  canAny: () => true,
  canAll: () => true,
});

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const isLoading = status === 'loading';

  // In standalone dev mode with RBAC bypass or standard user, allow full permissions
  const value = useMemo<PermissionsContextValue>(() => {
    return {
      permissions: [
        'assessments:read',
        'assessments:write',
        'assessments:moderate',
        'job_profiles:read',
        'job_profiles:write',
      ],
      isLoading,
      can: () => true,
      canAny: () => true,
      canAll: () => true,
    };
  }, [isLoading]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions(): PermissionsContextValue {
  return useContext(PermissionsContext);
}
