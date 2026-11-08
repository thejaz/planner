import { DEFAULT_CODES, DEFAULT_GROUPS } from '../src/core/model';

// Example project codes and groups for the synthetic notes in these tests. The plugin
// ships with none; it always uses the codes and groups registered in its settings.
const groups = [['IRP', 'TRN', 'STR', 'NVE', 'QYN', 'MDR'], ['STD', 'TCH', 'CAR'], ['FRM', 'CHP', 'JIB', 'HAY'], ['PRT', 'ORG', 'ZOT', 'MED']];
DEFAULT_GROUPS.splice(0, DEFAULT_GROUPS.length, ...groups);
DEFAULT_CODES.splice(0, DEFAULT_CODES.length, ...groups.flat(), 'IR2', 'KCW', 'KCWI', 'DBK', 'DTFL', 'OBJ', 'ONT', 'TRD', 'LOD', 'NVP', 'TIN');
