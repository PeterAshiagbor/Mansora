import { writeFileSync } from 'node:fs';
import { roleMatrixMarkdown } from '../../packages/domain/src/permissions';

writeFileSync(new URL('../../docs/user-guide/who-can-do-what.md', import.meta.url), roleMatrixMarkdown());
console.log('Wrote docs/user-guide/who-can-do-what.md');
