const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../extension.js'), 'utf8');
function helper(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  if (start < 0) throw new Error(`missing helper ${name}`);
  const body = source.slice(start, source.indexOf('\n}', start) + 2);
  // Extract the real error dependencies too; a missing helper must fail loudly,
  // never turn a validation assertion into an accidental ReferenceError test.
  const dependencies = ['bridgeError', 'httpStatus', 'describeFetchError']
    .filter(dependency => dependency !== name && body.includes(dependency));
  return dependencies.map(helper).concat(body).join('\n');
}
function context(names, values = {}) {
  const ctx = vm.createContext({ console, structuredClone, URL, Request, Response, Headers, AbortController, AbortSignal, DOMException, crypto: require('node:crypto').webcrypto, setTimeout, clearTimeout, ...values });
  vm.runInContext(names.map(helper).join('\n'), ctx);
  return ctx;
}
module.exports = { helper, context, source };
