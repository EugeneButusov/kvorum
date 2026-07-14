import '@testing-library/jest-dom/vitest';
import { expect } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';

// Register the axe accessibility matcher (§6.19 automated checks). vitest-axe's extend-expect entry
// is a no-op under vitest, so wire the matcher directly.
expect.extend(axeMatchers);
