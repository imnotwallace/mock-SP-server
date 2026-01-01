export const VERSION = '1.0.0';

// Re-export server components
export { createMockServer } from './server.js';
export type { MockServer } from './server.js';
export { GraphError } from './middleware/error.js';
export { parseODataQuery, formatODataResponse } from './middleware/odata.js';
export type { ODataQuery, ODataResponse } from './middleware/odata.js';
