import { randomUUID } from 'node:crypto';

export const unique = (label: string) => `QA-${label}-${randomUUID().slice(0, 8)}`;
