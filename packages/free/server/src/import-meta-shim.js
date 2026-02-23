// Shim for import.meta in CommonJS
export const url = require('url').pathToFileURL(__filename).toString();
export default { url };
