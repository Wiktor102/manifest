import { describe, it, expect } from 'vitest';
import { formatNumber } from '../../../src/services/formatters';
describe('tmp', () => { it('works', () => { expect(formatNumber(1000)).toBe('1k'); }); });
