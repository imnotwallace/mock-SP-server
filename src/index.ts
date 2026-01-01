export const VERSION = '1.0.0';

// Re-export server components
export { createMockServer, MockServer } from './server.js';
export { GraphError } from './middleware/error.js';
export { ODataQuery, ODataResponse, parseODataQuery, formatODataResponse } from './middleware/odata.js';
