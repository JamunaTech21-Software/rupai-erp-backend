import { z } from 'zod';

/**
 * Plain messages for every form (they show under the field in the dashboard). Schemas can still give
 * their own message; this only replaces zod's defaults.
 */
z.config({
  customError: (issue) => {
    if (issue.code === 'invalid_type' && (issue.input === undefined || issue.input === null))
      return 'This field is required.';
    if (issue.code === 'invalid_type') return `Must be a ${issue.expected}.`;
    return undefined;
  },
});

export { z };
