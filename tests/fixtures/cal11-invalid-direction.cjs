// This fixture is compiled by tsconfig.electron-checkjs.json and is not executed.
const { transferView } = require('../../electron/file-transfer-utils.cjs');

/** @type {never} */
const unavailableRecord = /** @type {never} */ ({});

// @ts-expect-error CAL-11 proof: the pilot rejects an unsupported transfer direction.
transferView(unavailableRecord, 'sideways');
