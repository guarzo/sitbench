import { describe, expect, it } from 'vitest';
import { parseAnalyzeArguments } from '../src/index.js';

describe('parseAnalyzeArguments', () => {
  it('parses analyze options without treating values as positional arguments', () => {
    expect(
      parseAnalyzeArguments([
        'analyze',
        '--site',
        'Core Bastion',
        '--profile',
        '8 Kikis + 2 Deacons',
        '--logs',
        '/mnt/c/logs',
        '--archive',
        '/archive',
      ]),
    ).toEqual({
      site: 'Core Bastion',
      profile: '8 Kikis + 2 Deacons',
      logs: '/mnt/c/logs',
      archive: '/archive',
    });
  });

  it('rejects an unknown command instead of silently analyzing unintended input', () => {
    expect(() => parseAnalyzeArguments(['export'])).toThrow('Usage: sitbench analyze');
  });
});
