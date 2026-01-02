/**
 * OData $filter query parameter parser and evaluator
 * Supports: comparison operators, logical operators, string functions, nested properties
 */

// ============================================================================
// Types
// ============================================================================

export type FilterExpression =
  | ComparisonExpression
  | LogicalExpression
  | FunctionExpression;

export interface ComparisonExpression {
  type: 'comparison';
  left: string;  // Property path (e.g., "name", "fields/Status")
  operator: 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le';
  right: string | number | boolean | null;
}

export interface LogicalExpression {
  type: 'logical';
  operator: 'and' | 'or' | 'not';
  operands: FilterExpression[];
}

export interface FunctionExpression {
  type: 'function';
  name: 'startswith' | 'endswith' | 'contains' | 'substringof';
  args: (string | FilterExpression)[];
}

// Token types for lexer
type TokenType =
  | 'IDENTIFIER'
  | 'STRING'
  | 'NUMBER'
  | 'BOOLEAN'
  | 'NULL'
  | 'OPERATOR'
  | 'LOGICAL'
  | 'NOT'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'EOF';

interface Token {
  type: TokenType;
  value: string;
}

// ============================================================================
// Tokenizer
// ============================================================================

const COMPARISON_OPERATORS = ['eq', 'ne', 'gt', 'ge', 'lt', 'le'];
const LOGICAL_OPERATORS = ['and', 'or'];
const STRING_FUNCTIONS = ['startswith', 'endswith', 'contains', 'substringof'];

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  const peek = (): string => input[pos] || '';
  const advance = (): string => input[pos++] || '';
  const skipWhitespace = (): void => {
    while (pos < input.length && /\s/.test(peek())) pos++;
  };

  while (pos < input.length) {
    skipWhitespace();
    if (pos >= input.length) break;

    const char = peek();

    // Parentheses
    if (char === '(') {
      tokens.push({ type: 'LPAREN', value: advance() });
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'RPAREN', value: advance() });
      continue;
    }

    // Comma
    if (char === ',') {
      tokens.push({ type: 'COMMA', value: advance() });
      continue;
    }

    // String literal (single-quoted)
    if (char === "'") {
      advance(); // consume opening quote
      let str = '';
      while (pos < input.length) {
        if (peek() === "'" && input[pos + 1] === "'") {
          // Escaped quote ('') - add one quote and skip both
          str += "'";
          pos += 2;
        } else if (peek() === "'") {
          // End of string
          break;
        } else {
          str += advance();
        }
      }
      if (pos >= input.length) {
        throw new Error('Unclosed string literal');
      }
      advance(); // consume closing quote
      tokens.push({ type: 'STRING', value: str });
      continue;
    }

    // Number (including negative and decimal)
    if (/[-\d]/.test(char) && (char !== '-' || /\d/.test(input[pos + 1] || ''))) {
      let num = '';
      if (char === '-') num += advance();
      while (pos < input.length && /[\d.]/.test(peek())) {
        num += advance();
      }
      tokens.push({ type: 'NUMBER', value: num });
      continue;
    }

    // Identifiers, keywords, operators
    if (/[a-zA-Z_]/.test(char)) {
      let word = '';
      while (pos < input.length && /[a-zA-Z0-9_/.]/.test(peek())) {
        word += advance();
      }
      const lower = word.toLowerCase();

      if (COMPARISON_OPERATORS.includes(lower)) {
        tokens.push({ type: 'OPERATOR', value: lower });
      } else if (LOGICAL_OPERATORS.includes(lower)) {
        tokens.push({ type: 'LOGICAL', value: lower });
      } else if (lower === 'not') {
        tokens.push({ type: 'NOT', value: lower });
      } else if (lower === 'true' || lower === 'false') {
        tokens.push({ type: 'BOOLEAN', value: lower });
      } else if (lower === 'null') {
        tokens.push({ type: 'NULL', value: lower });
      } else {
        tokens.push({ type: 'IDENTIFIER', value: word });
      }
      continue;
    }

    throw new Error(`Unexpected character: ${char} at position ${pos}`);
  }

  tokens.push({ type: 'EOF', value: '' });
  return tokens;
}

// ============================================================================
// Parser
// ============================================================================

class Parser {
  private tokens: Token[];
  private pos: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos] || { type: 'EOF', value: '' };
  }

  private advance(): Token {
    return this.tokens[this.pos++] || { type: 'EOF', value: '' };
  }

  private expect(type: TokenType, value?: string): Token {
    const token = this.advance();
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      throw new Error(`Expected ${type}${value ? ` '${value}'` : ''}, got ${token.type} '${token.value}'`);
    }
    return token;
  }

  parse(): FilterExpression {
    const expr = this.parseOr();
    if (this.peek().type !== 'EOF') {
      throw new Error(`Unexpected token: ${this.peek().value}`);
    }
    return expr;
  }

  // Lowest precedence: OR
  private parseOr(): FilterExpression {
    let left = this.parseAnd();

    while (this.peek().type === 'LOGICAL' && this.peek().value === 'or') {
      this.advance(); // consume 'or'
      const right = this.parseAnd();
      left = {
        type: 'logical',
        operator: 'or',
        operands: [left, right]
      };
    }

    return left;
  }

  // AND has higher precedence than OR
  private parseAnd(): FilterExpression {
    let left = this.parseNot();

    while (this.peek().type === 'LOGICAL' && this.peek().value === 'and') {
      this.advance(); // consume 'and'
      const right = this.parseNot();
      left = {
        type: 'logical',
        operator: 'and',
        operands: [left, right]
      };
    }

    return left;
  }

  // NOT (unary)
  private parseNot(): FilterExpression {
    if (this.peek().type === 'NOT') {
      this.advance(); // consume 'not'
      const operand = this.parseNot();
      return {
        type: 'logical',
        operator: 'not',
        operands: [operand]
      };
    }
    return this.parsePrimary();
  }

  // Primary: comparison, function call, or parenthesized expression
  private parsePrimary(): FilterExpression {
    // Parenthesized expression
    if (this.peek().type === 'LPAREN') {
      this.advance(); // consume '('
      const expr = this.parseOr();
      this.expect('RPAREN');
      return expr;
    }

    const token = this.peek();

    // Function call: functionName(args)
    if (token.type === 'IDENTIFIER' && STRING_FUNCTIONS.includes(token.value.toLowerCase())) {
      return this.parseFunction();
    }

    // Comparison: property operator value
    return this.parseComparison();
  }

  private parseFunction(): FunctionExpression {
    const nameToken = this.advance();
    const funcName = nameToken.value.toLowerCase() as FunctionExpression['name'];

    this.expect('LPAREN');

    const args: (string | FilterExpression)[] = [];

    // Parse first argument
    if (this.peek().type !== 'RPAREN') {
      args.push(this.parseArgument());

      // Parse remaining arguments
      while (this.peek().type === 'COMMA') {
        this.advance(); // consume ','
        args.push(this.parseArgument());
      }
    }

    this.expect('RPAREN');

    return {
      type: 'function',
      name: funcName,
      args
    };
  }

  private parseArgument(): string {
    const token = this.advance();
    if (token.type === 'STRING') {
      return token.value;
    }
    if (token.type === 'IDENTIFIER') {
      return token.value;
    }
    throw new Error(`Expected string or identifier in function argument, got ${token.type}`);
  }

  private parseComparison(): ComparisonExpression {
    // Property path (may contain slashes for nested access)
    const leftToken = this.advance();
    if (leftToken.type !== 'IDENTIFIER') {
      throw new Error(`Expected property name, got ${leftToken.type} '${leftToken.value}'`);
    }
    const left = leftToken.value;

    // Operator
    const opToken = this.advance();
    if (opToken.type !== 'OPERATOR') {
      throw new Error(`Expected comparison operator, got ${opToken.type} '${opToken.value}'`);
    }
    const operator = opToken.value as ComparisonExpression['operator'];

    // Value
    const right = this.parseValue();

    return {
      type: 'comparison',
      left,
      operator,
      right
    };
  }

  private parseValue(): string | number | boolean | null {
    const token = this.advance();

    switch (token.type) {
      case 'STRING':
        return token.value;
      case 'NUMBER':
        return token.value.includes('.') ? parseFloat(token.value) : parseInt(token.value, 10);
      case 'BOOLEAN':
        return token.value === 'true';
      case 'NULL':
        return null;
      case 'IDENTIFIER':
        // Could be a GUID or datetime - treat as string
        return token.value;
      default:
        throw new Error(`Expected value, got ${token.type} '${token.value}'`);
    }
  }
}

// ============================================================================
// Public Parse Function
// ============================================================================

export function parseFilter(filterString: string): FilterExpression {
  const tokens = tokenize(filterString.trim());
  const parser = new Parser(tokens);
  return parser.parse();
}

// ============================================================================
// Evaluator
// ============================================================================

/**
 * Get a nested property value from an object using path notation
 * Supports: "name", "fields/Status", "createdBy/user/displayName"
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(/[/.]/);
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Compare two values with type coercion for dates
 */
function compareValues(
  left: unknown,
  operator: ComparisonExpression['operator'],
  right: unknown
): boolean {
  // Handle null comparisons
  if (right === null) {
    switch (operator) {
      case 'eq': return left === null || left === undefined;
      case 'ne': return left !== null && left !== undefined;
      default: return false;
    }
  }

  // Coerce left to comparable type
  let leftVal: string | number | boolean | null = null;
  let rightVal: string | number | boolean | null = right as string | number | boolean;

  if (left === null || left === undefined) {
    leftVal = null;
  } else if (typeof left === 'string') {
    leftVal = left;
    // Try to parse as date if right looks like a date
    if (typeof right === 'string' && /^\d{4}-\d{2}-\d{2}/.test(right)) {
      const leftDate = new Date(left).getTime();
      const rightDate = new Date(right).getTime();
      if (!isNaN(leftDate) && !isNaN(rightDate)) {
        leftVal = leftDate;
        rightVal = rightDate;
      }
    }
  } else if (typeof left === 'number') {
    leftVal = left;
    if (typeof right === 'string') {
      rightVal = parseFloat(right);
    }
  } else if (typeof left === 'boolean') {
    leftVal = left;
  }

  // Perform comparison
  switch (operator) {
    case 'eq': return leftVal === rightVal;
    case 'ne': return leftVal !== rightVal;
    case 'gt': return leftVal !== null && rightVal !== null && leftVal > rightVal;
    case 'ge': return leftVal !== null && rightVal !== null && leftVal >= rightVal;
    case 'lt': return leftVal !== null && rightVal !== null && leftVal < rightVal;
    case 'le': return leftVal !== null && rightVal !== null && leftVal <= rightVal;
    default: return false;
  }
}

/**
 * Evaluate a string function
 */
function evaluateFunction(func: FunctionExpression, item: Record<string, unknown>): boolean {
  const { name, args } = func;

  // Get property value (first arg for most functions)
  let propertyValue: string;
  let searchValue: string;

  if (name === 'substringof') {
    // substringof(searchValue, property) - arguments are reversed
    searchValue = String(args[0] || '');
    propertyValue = String(getNestedValue(item, String(args[1] || '')) || '');
  } else {
    // startswith, endswith, contains: (property, searchValue)
    propertyValue = String(getNestedValue(item, String(args[0] || '')) || '');
    searchValue = String(args[1] || '');
  }

  const propLower = propertyValue.toLowerCase();
  const searchLower = searchValue.toLowerCase();

  switch (name) {
    case 'startswith':
      return propLower.startsWith(searchLower);
    case 'endswith':
      return propLower.endsWith(searchLower);
    case 'contains':
      return propLower.includes(searchLower);
    case 'substringof':
      return propLower.includes(searchLower);
    default:
      return false;
  }
}

/**
 * Evaluate a filter expression against an item
 */
export function evaluateFilter(
  item: Record<string, unknown>,
  expression: FilterExpression
): boolean {
  switch (expression.type) {
    case 'comparison': {
      const leftValue = getNestedValue(item, expression.left);
      return compareValues(leftValue, expression.operator, expression.right);
    }

    case 'logical': {
      const { operator, operands } = expression;
      switch (operator) {
        case 'and':
          return operands.every(op => evaluateFilter(item, op));
        case 'or':
          return operands.some(op => evaluateFilter(item, op));
        case 'not':
          return !evaluateFilter(item, operands[0]);
        default:
          return false;
      }
    }

    case 'function':
      return evaluateFunction(expression, item);

    default:
      return false;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Apply a filter expression to an array of items
 */
export function applyFilter<T>(
  items: T[],
  filterString: string
): T[] {
  if (!filterString || filterString.trim() === '') {
    return items;
  }

  const expression = parseFilter(filterString);
  return items.filter(item => evaluateFilter(item as Record<string, unknown>, expression));
}

/**
 * Validate a filter expression without applying it
 * Returns true if valid, throws Error if invalid
 */
export function isValidFilter(filterString: string): boolean {
  try {
    parseFilter(filterString);
    return true;
  } catch {
    return false;
  }
}
