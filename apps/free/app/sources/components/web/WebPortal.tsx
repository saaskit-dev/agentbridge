import React from 'react';
import { Platform } from 'react-native';

type CreatePortal = (
  children: React.ReactNode,
  container: Element | DocumentFragment
) => React.ReactNode;

export function WebPortal({ children }: { children: React.ReactNode }) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    return <>{children}</>;
  }

  const { createPortal } = require('react-dom') as { createPortal: CreatePortal };
  return createPortal(children, document.body);
}
