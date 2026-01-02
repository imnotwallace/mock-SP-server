import { describe, it, expect } from 'vitest';
import { parseFilter, evaluateFilter, applyFilter, isValidFilter } from '../../src/utils/odata-filter.js';
import type { ComparisonExpression, LogicalExpression, FunctionExpression } from '../../src/utils/odata-filter.js';

describe('OData $filter', () => {
  describe('parseFilter', () => {
    describe('comparison expressions', () => {
      it('parses simple equality with string', () => {
        const result = parseFilter("name eq 'test.txt'");
        expect(result).toEqual({
          type: 'comparison',
          left: 'name',
          operator: 'eq',
          right: 'test.txt'
        });
      });

      it('parses equality with integer', () => {
        const result = parseFilter('size eq 1000');
        expect(result).toEqual({
          type: 'comparison',
          left: 'size',
          operator: 'eq',
          right: 1000
        });
      });

      it('parses equality with decimal', () => {
        const result = parseFilter('price eq 19.99');
        expect(result).toEqual({
          type: 'comparison',
          left: 'price',
          operator: 'eq',
          right: 19.99
        });
      });

      it('parses equality with boolean true', () => {
        const result = parseFilter('isActive eq true');
        expect(result).toEqual({
          type: 'comparison',
          left: 'isActive',
          operator: 'eq',
          right: true
        });
      });

      it('parses equality with boolean false', () => {
        const result = parseFilter('isActive eq false');
        expect(result).toEqual({
          type: 'comparison',
          left: 'isActive',
          operator: 'eq',
          right: false
        });
      });

      it('parses equality with null', () => {
        const result = parseFilter('description eq null');
        expect(result).toEqual({
          type: 'comparison',
          left: 'description',
          operator: 'eq',
          right: null
        });
      });

      it('parses not equals', () => {
        const result = parseFilter("status ne 'draft'");
        expect(result).toEqual({
          type: 'comparison',
          left: 'status',
          operator: 'ne',
          right: 'draft'
        });
      });

      it('parses greater than', () => {
        const result = parseFilter('size gt 1000');
        expect(result).toEqual({
          type: 'comparison',
          left: 'size',
          operator: 'gt',
          right: 1000
        });
      });

      it('parses greater than or equal', () => {
        const result = parseFilter('size ge 1000');
        expect(result).toEqual({
          type: 'comparison',
          left: 'size',
          operator: 'ge',
          right: 1000
        });
      });

      it('parses less than', () => {
        const result = parseFilter('size lt 5000');
        expect(result).toEqual({
          type: 'comparison',
          left: 'size',
          operator: 'lt',
          right: 5000
        });
      });

      it('parses less than or equal', () => {
        const result = parseFilter('size le 5000');
        expect(result).toEqual({
          type: 'comparison',
          left: 'size',
          operator: 'le',
          right: 5000
        });
      });

      it('parses nested field access with slash', () => {
        const result = parseFilter("fields/Status eq 'Active'");
        expect(result).toEqual({
          type: 'comparison',
          left: 'fields/Status',
          operator: 'eq',
          right: 'Active'
        });
      });

      it('parses deeply nested field access', () => {
        const result = parseFilter("createdBy/user/displayName eq 'John'");
        expect(result).toEqual({
          type: 'comparison',
          left: 'createdBy/user/displayName',
          operator: 'eq',
          right: 'John'
        });
      });

      it('handles strings with escaped single quotes', () => {
        const result = parseFilter("name eq 'O''Brien'");
        expect(result.type).toBe('comparison');
        expect((result as ComparisonExpression).right).toBe("O'Brien");
      });
    });

    describe('logical expressions', () => {
      it('parses AND expression', () => {
        const result = parseFilter('size gt 100 and size lt 1000');
        expect(result.type).toBe('logical');
        const logical = result as LogicalExpression;
        expect(logical.operator).toBe('and');
        expect(logical.operands).toHaveLength(2);
        expect(logical.operands[0].type).toBe('comparison');
        expect(logical.operands[1].type).toBe('comparison');
      });

      it('parses OR expression', () => {
        const result = parseFilter("name eq 'a.txt' or name eq 'b.txt'");
        expect(result.type).toBe('logical');
        const logical = result as LogicalExpression;
        expect(logical.operator).toBe('or');
        expect(logical.operands).toHaveLength(2);
      });

      it('parses NOT expression', () => {
        const result = parseFilter('not isDeleted eq true');
        expect(result.type).toBe('logical');
        const logical = result as LogicalExpression;
        expect(logical.operator).toBe('not');
        expect(logical.operands).toHaveLength(1);
      });

      it('parses complex AND/OR with correct precedence', () => {
        // AND has higher precedence than OR
        const result = parseFilter("a eq 1 or b eq 2 and c eq 3");
        expect(result.type).toBe('logical');
        const logical = result as LogicalExpression;
        expect(logical.operator).toBe('or');
        // Right side should be the AND
        expect((logical.operands[1] as LogicalExpression).operator).toBe('and');
      });

      it('parses parenthesized expressions', () => {
        const result = parseFilter("(a eq 1 or b eq 2) and c eq 3");
        expect(result.type).toBe('logical');
        const logical = result as LogicalExpression;
        expect(logical.operator).toBe('and');
        // Left side should be the OR
        expect((logical.operands[0] as LogicalExpression).operator).toBe('or');
      });

      it('parses multiple ANDs', () => {
        const result = parseFilter('a eq 1 and b eq 2 and c eq 3');
        expect(result.type).toBe('logical');
      });
    });

    describe('function expressions', () => {
      it('parses startswith', () => {
        const result = parseFilter("startswith(name, 'Report')");
        expect(result.type).toBe('function');
        const func = result as FunctionExpression;
        expect(func.name).toBe('startswith');
        expect(func.args).toEqual(['name', 'Report']);
      });

      it('parses endswith', () => {
        const result = parseFilter("endswith(name, '.pdf')");
        expect(result.type).toBe('function');
        const func = result as FunctionExpression;
        expect(func.name).toBe('endswith');
        expect(func.args).toEqual(['name', '.pdf']);
      });

      it('parses contains', () => {
        const result = parseFilter("contains(name, 'draft')");
        expect(result.type).toBe('function');
        const func = result as FunctionExpression;
        expect(func.name).toBe('contains');
        expect(func.args).toEqual(['name', 'draft']);
      });

      it('parses substringof', () => {
        const result = parseFilter("substringof('test', name)");
        expect(result.type).toBe('function');
        const func = result as FunctionExpression;
        expect(func.name).toBe('substringof');
        expect(func.args).toEqual(['test', 'name']);
      });

      it('parses function combined with AND', () => {
        const result = parseFilter("startswith(name, 'Report') and size gt 1000");
        expect(result.type).toBe('logical');
        const logical = result as LogicalExpression;
        expect(logical.operator).toBe('and');
        expect(logical.operands[0].type).toBe('function');
        expect(logical.operands[1].type).toBe('comparison');
      });

      it('parses NOT with function', () => {
        const result = parseFilter("not startswith(name, 'temp')");
        expect(result.type).toBe('logical');
        const logical = result as LogicalExpression;
        expect(logical.operator).toBe('not');
        expect(logical.operands[0].type).toBe('function');
      });
    });

    describe('error handling', () => {
      it('throws on invalid operator', () => {
        expect(() => parseFilter('name foo 1')).toThrow();
      });

      it('throws on missing value', () => {
        expect(() => parseFilter('name eq')).toThrow();
      });

      it('throws on unclosed string', () => {
        expect(() => parseFilter("name eq 'test")).toThrow();
      });

      it('throws on unexpected character', () => {
        expect(() => parseFilter('name @ value')).toThrow();
      });
    });
  });

  describe('evaluateFilter', () => {
    describe('comparison operators', () => {
      const item = { name: 'test.txt', size: 500, active: true, count: 0, empty: null };

      it('evaluates equality correctly', () => {
        expect(evaluateFilter(item, parseFilter("name eq 'test.txt'"))).toBe(true);
        expect(evaluateFilter(item, parseFilter("name eq 'other.txt'"))).toBe(false);
        expect(evaluateFilter(item, parseFilter('size eq 500'))).toBe(true);
        expect(evaluateFilter(item, parseFilter('active eq true'))).toBe(true);
      });

      it('evaluates not equals correctly', () => {
        expect(evaluateFilter(item, parseFilter("name ne 'other.txt'"))).toBe(true);
        expect(evaluateFilter(item, parseFilter("name ne 'test.txt'"))).toBe(false);
      });

      it('evaluates greater than correctly', () => {
        expect(evaluateFilter(item, parseFilter('size gt 400'))).toBe(true);
        expect(evaluateFilter(item, parseFilter('size gt 500'))).toBe(false);
        expect(evaluateFilter(item, parseFilter('size gt 600'))).toBe(false);
      });

      it('evaluates greater than or equal correctly', () => {
        expect(evaluateFilter(item, parseFilter('size ge 400'))).toBe(true);
        expect(evaluateFilter(item, parseFilter('size ge 500'))).toBe(true);
        expect(evaluateFilter(item, parseFilter('size ge 600'))).toBe(false);
      });

      it('evaluates less than correctly', () => {
        expect(evaluateFilter(item, parseFilter('size lt 600'))).toBe(true);
        expect(evaluateFilter(item, parseFilter('size lt 500'))).toBe(false);
        expect(evaluateFilter(item, parseFilter('size lt 400'))).toBe(false);
      });

      it('evaluates less than or equal correctly', () => {
        expect(evaluateFilter(item, parseFilter('size le 600'))).toBe(true);
        expect(evaluateFilter(item, parseFilter('size le 500'))).toBe(true);
        expect(evaluateFilter(item, parseFilter('size le 400'))).toBe(false);
      });

      it('evaluates null comparisons correctly', () => {
        expect(evaluateFilter(item, parseFilter('empty eq null'))).toBe(true);
        expect(evaluateFilter(item, parseFilter('name eq null'))).toBe(false);
        expect(evaluateFilter(item, parseFilter('empty ne null'))).toBe(false);
        expect(evaluateFilter(item, parseFilter('name ne null'))).toBe(true);
      });

      it('evaluates zero correctly', () => {
        expect(evaluateFilter(item, parseFilter('count eq 0'))).toBe(true);
        expect(evaluateFilter(item, parseFilter('count gt 0'))).toBe(false);
      });
    });

    describe('nested property access', () => {
      const item = {
        name: 'test.txt',
        fields: {
          Status: 'Active',
          Priority: 1
        },
        createdBy: {
          user: {
            displayName: 'John Doe',
            email: 'john@example.com'
          }
        }
      };

      it('evaluates nested fields with slash notation', () => {
        expect(evaluateFilter(item, parseFilter("fields/Status eq 'Active'"))).toBe(true);
        expect(evaluateFilter(item, parseFilter("fields/Status eq 'Inactive'"))).toBe(false);
        expect(evaluateFilter(item, parseFilter('fields/Priority eq 1'))).toBe(true);
      });

      it('evaluates deeply nested fields', () => {
        expect(evaluateFilter(item, parseFilter("createdBy/user/displayName eq 'John Doe'"))).toBe(true);
        expect(evaluateFilter(item, parseFilter("createdBy/user/email eq 'john@example.com'"))).toBe(true);
      });

      it('handles missing nested properties', () => {
        expect(evaluateFilter(item, parseFilter("fields/Missing eq 'test'"))).toBe(false);
        expect(evaluateFilter(item, parseFilter('fields/Missing eq null'))).toBe(true);
      });
    });

    describe('logical operators', () => {
      const item = { name: 'test.txt', size: 500, active: true };

      it('evaluates AND correctly', () => {
        expect(evaluateFilter(item, parseFilter('size gt 400 and size lt 600'))).toBe(true);
        expect(evaluateFilter(item, parseFilter('size gt 400 and size lt 450'))).toBe(false);
        expect(evaluateFilter(item, parseFilter('size gt 550 and size lt 600'))).toBe(false);
      });

      it('evaluates OR correctly', () => {
        expect(evaluateFilter(item, parseFilter("name eq 'test.txt' or name eq 'other.txt'"))).toBe(true);
        expect(evaluateFilter(item, parseFilter("name eq 'a.txt' or name eq 'b.txt'"))).toBe(false);
      });

      it('evaluates NOT correctly', () => {
        expect(evaluateFilter(item, parseFilter('not active eq false'))).toBe(true);
        expect(evaluateFilter(item, parseFilter('not active eq true'))).toBe(false);
      });

      it('evaluates complex expressions correctly', () => {
        expect(evaluateFilter(item, parseFilter("(size gt 400 and size lt 600) or name eq 'other.txt'"))).toBe(true);
        expect(evaluateFilter(item, parseFilter("size gt 600 or name eq 'test.txt'"))).toBe(true);
      });
    });

    describe('string functions', () => {
      const item = { name: 'Report-2024-Q1.pdf', title: 'Quarterly Report' };

      it('evaluates startswith correctly', () => {
        expect(evaluateFilter(item, parseFilter("startswith(name, 'Report')"))).toBe(true);
        expect(evaluateFilter(item, parseFilter("startswith(name, 'report')"))).toBe(true); // case-insensitive
        expect(evaluateFilter(item, parseFilter("startswith(name, 'Document')"))).toBe(false);
      });

      it('evaluates endswith correctly', () => {
        expect(evaluateFilter(item, parseFilter("endswith(name, '.pdf')"))).toBe(true);
        expect(evaluateFilter(item, parseFilter("endswith(name, '.PDF')"))).toBe(true); // case-insensitive
        expect(evaluateFilter(item, parseFilter("endswith(name, '.docx')"))).toBe(false);
      });

      it('evaluates contains correctly', () => {
        expect(evaluateFilter(item, parseFilter("contains(name, '2024')"))).toBe(true);
        expect(evaluateFilter(item, parseFilter("contains(name, 'Q1')"))).toBe(true);
        expect(evaluateFilter(item, parseFilter("contains(name, '2025')"))).toBe(false);
      });

      it('evaluates substringof correctly', () => {
        expect(evaluateFilter(item, parseFilter("substringof('2024', name)"))).toBe(true);
        expect(evaluateFilter(item, parseFilter("substringof('2025', name)"))).toBe(false);
      });

      it('evaluates combined function and comparison', () => {
        expect(evaluateFilter(item, parseFilter("startswith(name, 'Report') and endswith(name, '.pdf')"))).toBe(true);
      });
    });

    describe('date comparisons', () => {
      const item = {
        createdDateTime: '2024-06-15T10:30:00Z',
        modifiedDateTime: '2024-12-01T08:00:00Z'
      };

      it('compares dates with greater than', () => {
        expect(evaluateFilter(item, parseFilter("createdDateTime gt '2024-01-01'"))).toBe(true);
        expect(evaluateFilter(item, parseFilter("createdDateTime gt '2024-12-01'"))).toBe(false);
      });

      it('compares dates with less than', () => {
        expect(evaluateFilter(item, parseFilter("createdDateTime lt '2024-12-31'"))).toBe(true);
        expect(evaluateFilter(item, parseFilter("createdDateTime lt '2024-01-01'"))).toBe(false);
      });
    });
  });

  describe('applyFilter', () => {
    const items = [
      { name: 'a.txt', size: 100, type: 'file' },
      { name: 'b.pdf', size: 500, type: 'file' },
      { name: 'c.txt', size: 1000, type: 'file' },
      { name: 'folder1', size: 0, type: 'folder' }
    ];

    it('filters by equality', () => {
      const result = applyFilter(items, "name eq 'a.txt'");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('a.txt');
    });

    it('filters by size range', () => {
      const result = applyFilter(items, 'size gt 50 and size lt 600');
      expect(result).toHaveLength(2);
      expect(result.map(i => i.name)).toEqual(['a.txt', 'b.pdf']);
    });

    it('filters by type', () => {
      const result = applyFilter(items, "type eq 'folder'");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('folder1');
    });

    it('filters using OR', () => {
      const result = applyFilter(items, "name eq 'a.txt' or name eq 'c.txt'");
      expect(result).toHaveLength(2);
    });

    it('filters using string function', () => {
      const result = applyFilter(items, "endswith(name, '.txt')");
      expect(result).toHaveLength(2);
      expect(result.map(i => i.name)).toEqual(['a.txt', 'c.txt']);
    });

    it('returns all items for empty filter', () => {
      expect(applyFilter(items, '')).toHaveLength(4);
      expect(applyFilter(items, '  ')).toHaveLength(4);
    });

    it('returns empty array when nothing matches', () => {
      const result = applyFilter(items, 'size gt 10000');
      expect(result).toHaveLength(0);
    });
  });

  describe('isValidFilter', () => {
    it('returns true for valid expressions', () => {
      expect(isValidFilter("name eq 'test'")).toBe(true);
      expect(isValidFilter('size gt 100')).toBe(true);
      expect(isValidFilter("startswith(name, 'Report')")).toBe(true);
      expect(isValidFilter('a eq 1 and b eq 2')).toBe(true);
    });

    it('returns false for invalid expressions', () => {
      expect(isValidFilter('name foo value')).toBe(false);
      expect(isValidFilter("name eq 'unclosed")).toBe(false);
      expect(isValidFilter('@ invalid')).toBe(false);
    });
  });
});
