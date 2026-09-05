// Vercel serverless entry point.
//
// Deliberately plain JavaScript requiring the compiled output: the modern
// Vercel config builds functions from `api/`, and a .ts file here would sit
// outside the `rootDir` of tsconfig.json. `npm run build` has already emitted
// dist/ by the time this is traced.
//
// dist/server.js exports the Express app as a handler and, seeing VERCEL in
// the environment, does not bind a port.
module.exports = require("../dist/server.js").default;
