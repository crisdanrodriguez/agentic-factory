exports.up = (pgm) => {
  pgm.addColumn({ schema: 'factory', name: 'intake_revisions' }, {
    origin_provider: { type: 'text', notNull: false },
    origin_reference: { type: 'text', notNull: false },
    origin_updated_at: { type: 'timestamptz', notNull: false },
  });
  pgm.addConstraint({ schema: 'factory', name: 'intake_revisions' }, 'github_origin_pair', {
    check: "(source_kind = 'github' AND origin_provider = 'github' AND origin_reference IS NOT NULL AND origin_updated_at IS NOT NULL) OR (source_kind <> 'github' AND origin_provider IS NULL AND origin_reference IS NULL AND origin_updated_at IS NULL)",
  });
  pgm.sql("ALTER TABLE factory.intake_revisions DROP CONSTRAINT intake_revisions_source_kind_check");
  pgm.addConstraint({ schema: 'factory', name: 'intake_revisions' }, 'intake_revisions_source_kind_check', { check: "source_kind IN ('file','cli','github')" });
};

exports.down = (pgm) => {
  pgm.sql("ALTER TABLE factory.intake_revisions DROP CONSTRAINT intake_revisions_source_kind_check");
  pgm.sql("ALTER TABLE factory.intake_revisions DROP CONSTRAINT github_origin_pair");
  pgm.sql("ALTER TABLE factory.intake_revisions ADD CONSTRAINT intake_revisions_source_kind_check CHECK (source_kind IN ('file','cli'))");
  pgm.dropColumn({ schema: 'factory', name: 'intake_revisions' }, ['origin_provider', 'origin_reference', 'origin_updated_at']);
};
