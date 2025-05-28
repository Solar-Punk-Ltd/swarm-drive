// app.ts
const { createBeeClient, updateManifest } = require('./dist/utils/swarm');
(async () => {
  const { bee, ownerBatch } = await createBeeClient(
    'http://localhost:1633',
    process.env.BEE_SIGNER_KEY
  );
  // upload /tmp/foo.txt into your drive manifest:
  const newManifest = await updateManifest(
    bee,
    ownerBatch.batchID,
    require('./test-drive/.swarm-sync.json').lastManifest,
    '/tmp/foo.txt',
    'foo.txt',
    false
  );
  console.log('remote manifest:', newManifest);
})();
