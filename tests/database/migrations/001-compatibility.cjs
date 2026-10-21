exports.up = (pgm) => {
  pgm.sql(`
    CREATE SCHEMA af_compatibility;
    CREATE TABLE af_compatibility.records (id text PRIMARY KEY, organization_id text NOT NULL);
    ALTER TABLE af_compatibility.records ENABLE ROW LEVEL SECURITY;
    ALTER TABLE af_compatibility.records FORCE ROW LEVEL SECURITY;
    CREATE POLICY membership ON af_compatibility.records
      USING (organization_id = CASE session_user WHEN 'af_checkpoint_app' THEN 'synthetic-org-a' END)
      WITH CHECK (organization_id = CASE session_user WHEN 'af_checkpoint_app' THEN 'synthetic-org-a' END);
    GRANT USAGE ON SCHEMA af_compatibility TO af_checkpoint_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON af_compatibility.records TO af_checkpoint_app;
  `);
};
exports.down = () => { throw new Error('No automatic destructive rollback. Use a disposable checkpoint database.'); };
