import * as os from 'node:os';
import * as path from 'node:path';

export const sharedLogTestBaseDir = path.join(os.tmpdir(), `ungate-shared-log-store-${process.pid}`);
export const sharedLogTestPath = path.join(sharedLogTestBaseDir, 'extension.log');
