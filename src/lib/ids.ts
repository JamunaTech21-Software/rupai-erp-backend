import { ulid } from 'ulid';

/** Record ids are ULIDs: 26 characters, sortable by creation time. */
export const newId = (): string => ulid();
