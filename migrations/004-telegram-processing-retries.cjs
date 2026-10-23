// Additive upgrade for installations that have already applied migration 003.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE factory.telegram_updates
      ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      ADD COLUMN failure_kind text CHECK (failure_kind IN ('processing'));
    UPDATE factory.telegram_updates SET
      next_attempt_at=clock_timestamp()+interval '300 seconds', failure_kind='processing'
      WHERE state='pending' AND attempts>0;
    UPDATE factory.telegram_updates SET failure_kind='processing' WHERE state='exhausted';
  `);
};
exports.down = () => { throw new Error('Destructive rollback is not supported. Restore an authorized backup instead.'); };
