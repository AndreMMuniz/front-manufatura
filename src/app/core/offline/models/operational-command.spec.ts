import { describe, expect, it } from 'vitest';

import {
  OPERATIONAL_COMMAND_DEFINITIONS,
  OPERATIONAL_COMMAND_TYPES,
} from './operational-command';

describe('operational command contract', () => {
  it('closes the supported command matrix with one positive schema version per type', () => {
    expect(OPERATIONAL_COMMAND_TYPES).toEqual([
      'GENERATE_INSPECTION_ROUTE',
      'SAVE_MEASUREMENT',
      'FINISH_EXAM',
      'STOP_INSPECTION_ROUTE',
      'SAVE_INSPECTION',
      'START_OPERATION',
      'REPORT_OPERATION',
      'END_OPERATION',
      'START_BATCH',
      'REPORT_BATCH',
      'END_BATCH',
      'CREATE_STOP',
      'FINISH_STOP',
    ]);

    expect(Object.keys(OPERATIONAL_COMMAND_DEFINITIONS)).toEqual(
      OPERATIONAL_COMMAND_TYPES,
    );
    for (const commandType of OPERATIONAL_COMMAND_TYPES) {
      expect(OPERATIONAL_COMMAND_DEFINITIONS[commandType].payloadSchemaVersion)
        .toBeGreaterThan(0);
      expect(OPERATIONAL_COMMAND_DEFINITIONS[commandType].aggregateType).toMatch(
        /^(QUALITY_ROUTE|QUALITY_EXAM|QUALITY_INSPECTION|OPERATION|BATCH|STOP)$/,
      );
    }
  });
});
