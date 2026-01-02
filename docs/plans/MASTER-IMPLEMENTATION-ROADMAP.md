# Mock SharePoint Server - Master Implementation Roadmap

This document tracks all planned enhancements to make the mock SharePoint server more complete and production-ready.

## Implementation Priority Overview

| Priority | Feature | Status | Plan |
|----------|---------|--------|------|
| P1 | $filter OData Implementation | **Complete** | [Plan 01](./plan-01-odata-filter.md) |
| P1 | Copy/Move Operations | **Complete** | [Plan 02](./plan-02-copy-move-operations.md) |
| P1 | Delta Queries | **Complete** | [Plan 03](./plan-03-delta-queries.md) |
| P1 | @odata.nextLink Pagination | **Complete** | [Plan 04](./plan-04-pagination-nextlink.md) |
| P2 | Search API | **Complete** | [Plan 05](./plan-05-search-api.md) |
| P2 | Permissions Endpoints | **Complete** | [Plan 06](./plan-06-permissions.md) |
| P2 | File Versioning | **Complete** | [Plan 07](./plan-07-versioning.md) |
| P2 | Large File Upload Sessions | **Complete** | [Plan 08](./plan-08-large-file-upload.md) |
| P3 | Batch Requests | **Complete** | [Plan 09](./plan-09-batch-requests.md) |
| P3 | Webhooks/Subscriptions | **Complete** | [Plan 10](./plan-10-webhooks-subscriptions.md) |
| P3 | Thumbnails | **Complete** | [Plan 11](./plan-11-thumbnails.md) |

## Priority Definitions

- **P1 (High)**: Commonly used features essential for most SharePoint client testing
- **P2 (Medium)**: Important features for comprehensive testing scenarios
- **P3 (Lower)**: Nice-to-have features for advanced use cases

## Current State Summary

### Implemented
- Sites API (list, get, subsites)
- Lists API (CRUD operations)
- Drives API (file operations, metadata)
- OAuth mock authentication
- OData $select, $expand, $top, $skip, $count, $filter
- @odata.nextLink pagination with $skiptoken
- File upload/download/delete
- Copy/move operations with async monitoring
- Delta queries for change tracking
- SQLite persistence with change log
- Filesystem hierarchy scanning
- Search API with query processing
- Large file chunked upload sessions
- Batch request processing
- Permissions and sharing endpoints
- File versioning with restore
- Webhook subscriptions and change notifications

- Thumbnail generation with image processing

## Architecture Considerations

All implementations should:
1. Follow existing patterns in `src/routes/`, `src/services/`, `src/middleware/`
2. Return Microsoft Graph compatible response formats
3. Include comprehensive tests in `tests/`
4. Update types in `src/types/`
5. Use the existing database service for persistence
6. Handle errors via `GraphError` class

## Database Schema Extensions

Several features require schema additions:

```sql
-- Copy operations (Plan 02) - IMPLEMENTED
CREATE TABLE copy_operations (id, source_item_id, target_drive_id, target_folder_id, new_name, status, percentage_complete, resource_id, error_message, created_at, completed_at);

-- Delta queries (Plan 03) - IMPLEMENTED
CREATE TABLE change_log (id, item_id, drive_id, change_type, change_token, timestamp, item_snapshot);
CREATE TABLE delta_tokens (token, drive_id, created_at, last_change_id);

-- Permissions (Plan 06)
-- Table exists, needs population and endpoints

-- Versioning (Plan 07)
CREATE TABLE versions (id, item_id, version_number, content_path, created_at, created_by);

-- Upload sessions (Plan 08)
CREATE TABLE upload_sessions (id, item_path, expected_size, uploaded_bytes, expires_at, chunks);

-- Subscriptions (Plan 10)
CREATE TABLE subscriptions (id, resource, change_types, notification_url, expiration, client_state);
```

## Testing Strategy

Each feature should include:
1. Unit tests for new utilities/services
2. Integration tests for API endpoints
3. Edge case coverage (errors, invalid inputs)
4. OData parameter interaction tests

## Implementation Order Recommendation

```
Phase 1: Core OData & Operations - COMPLETE
  1. $filter implementation (enables real query testing)
  2. Pagination with @odata.nextLink (correctness)
  3. Copy/Move operations (common operations)
  4. Delta queries (sync scenarios)

Phase 2: Sync & Search
  5. Search API (discovery scenarios)

Phase 3: Collaboration Features
  6. Permissions (access control testing)
  7. Versioning (document management)

Phase 4: Advanced Features
  8. Large file uploads (performance testing)
  9. Batch requests (optimization testing)
  10. Webhooks (event-driven testing)
  11. Thumbnails (UI preview testing)
```

## Contributing

When implementing a feature:
1. Read the specific plan document
2. Create a feature branch
3. Implement with tests
4. Update this document's status
5. Submit PR with plan reference
