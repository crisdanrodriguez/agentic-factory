exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE factory.intake_revisions DROP CONSTRAINT intake_revisions_source_kind_check;
    ALTER TABLE factory.intake_revisions ADD CONSTRAINT intake_revisions_source_kind_check CHECK (source_kind IN ('file','cli','telegram','slack'));
    CREATE TABLE factory.slack_installations (
      id text PRIMARY KEY, team_id text NOT NULL, app_id text NOT NULL, bot_id text NOT NULL, bot_user_id text NOT NULL, UNIQUE(team_id,app_id),
      bot_role name NOT NULL UNIQUE, admin_role name NOT NULL,
      expected_user text NOT NULL,
      organization_id text NOT NULL, project_id text NOT NULL, owner_id text NOT NULL,
      CHECK (bot_role <> admin_role),
      FOREIGN KEY (organization_id,project_id) REFERENCES factory.projects
    );
    CREATE TABLE factory.slack_pairings (
      installation_id text PRIMARY KEY REFERENCES factory.slack_installations,
      generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
      state text NOT NULL DEFAULT 'revoked' CHECK (state IN ('issued','pending','active','revoked')),
      challenge_hash text CHECK (challenge_hash ~ '^[0-9a-f]{64}$'),
      expires_at timestamptz, chat_id text, claimed_at timestamptz,
      rejected_count bigint NOT NULL DEFAULT 0,
      command_times double precision[] NOT NULL DEFAULT '{}', tokens double precision NOT NULL DEFAULT 3 CHECK(tokens BETWEEN 0 AND 3),
      token_time timestamptz NOT NULL DEFAULT clock_timestamp(), next_send_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK(cardinality(command_times)<=10),
      CHECK (state NOT IN ('pending','active') OR chat_id IS NOT NULL),
      CHECK (state NOT IN ('issued','pending') OR (challenge_hash IS NOT NULL AND expires_at IS NOT NULL))
    );
    CREATE TABLE factory.slack_updates (
      installation_id text NOT NULL REFERENCES factory.slack_installations,
      update_id text NOT NULL CHECK (update_id ~ '^Ev[A-Z0-9]{2,63}$'), digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
      generation integer NOT NULL, payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 20000),
      state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','done','exhausted')),
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
      next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(), failure_kind text CHECK(failure_kind IN ('processing')),
      PRIMARY KEY (installation_id,update_id)
    );
    CREATE TABLE factory.slack_outbox (
      installation_id text NOT NULL, update_id text NOT NULL,
      generation integer NOT NULL, chat_id text NOT NULL,
      body text NOT NULL CHECK (octet_length(body) BETWEEN 1 AND 2048),
      state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sent','exhausted','revoked')),
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
      next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (installation_id,update_id),
      FOREIGN KEY (installation_id,update_id) REFERENCES factory.slack_updates
    );
    ALTER TABLE factory.slack_installations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE factory.slack_installations FORCE ROW LEVEL SECURITY;
    CREATE POLICY slack_installation_read ON factory.slack_installations FOR SELECT
      USING (session_user IN (bot_role,admin_role));
    CREATE FUNCTION factory.guard_slack_pairing() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE installation factory.slack_installations;
    BEGIN
      SELECT * INTO STRICT installation FROM factory.slack_installations WHERE id=OLD.installation_id;
      IF NEW.installation_id <> OLD.installation_id THEN RAISE EXCEPTION 'Pairing identity is immutable'; END IF;
      IF session_user = installation.bot_role THEN
        IF (NEW.state,NEW.generation,NEW.challenge_hash,NEW.expires_at,NEW.chat_id,NEW.claimed_at) IS NOT DISTINCT FROM
          (OLD.state,OLD.generation,OLD.challenge_hash,OLD.expires_at,OLD.chat_id,OLD.claimed_at) THEN RETURN NEW; END IF;
        IF OLD.state <> 'issued' OR NEW.state <> 'pending' OR OLD.expires_at <= clock_timestamp()
          OR NEW.generation <> OLD.generation OR NEW.challenge_hash IS DISTINCT FROM OLD.challenge_hash
          OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.chat_id IS NULL THEN
          RAISE EXCEPTION 'Bot cannot administer pairing';
        END IF;
      ELSIF session_user <> installation.admin_role THEN RAISE EXCEPTION 'Pairing administration denied';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER slack_pairing_guard BEFORE UPDATE ON factory.slack_pairings
      FOR EACH ROW EXECUTE FUNCTION factory.guard_slack_pairing();
    CREATE FUNCTION factory.bound_slack_storage() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE total integer;
    BEGIN
      PERFORM FROM factory.slack_pairings WHERE installation_id=NEW.installation_id FOR UPDATE;
      SELECT count(*) INTO total FROM factory.slack_updates WHERE installation_id=NEW.installation_id;
      IF total >= 1000 THEN RAISE EXCEPTION 'Slack retention limit reached'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER slack_storage_bound BEFORE INSERT ON factory.slack_updates
      FOR EACH ROW EXECUTE FUNCTION factory.bound_slack_storage();
  `);
  for (const table of ['slack_pairings','slack_updates','slack_outbox']) {
    const bot = `EXISTS (SELECT FROM factory.slack_installations i WHERE i.id=${table}.installation_id AND i.bot_role=session_user)`;
    const admin = `EXISTS (SELECT FROM factory.slack_installations i WHERE i.id=${table}.installation_id AND i.admin_role=session_user)`;
    pgm.sql(`ALTER TABLE factory.${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE factory.${table} FORCE ROW LEVEL SECURITY;
      CREATE POLICY slack_read ON factory.${table} FOR SELECT USING (${bot} OR ${admin});
      CREATE POLICY slack_update ON factory.${table} FOR UPDATE USING (${bot}${table === 'slack_pairings' ? ` OR ${admin}` : ''})
        WITH CHECK (${bot}${table === 'slack_pairings' ? ` OR ${admin}` : ''});`);
    if (['slack_updates','slack_outbox'].includes(table)) pgm.sql(`CREATE POLICY slack_insert ON factory.${table} FOR INSERT WITH CHECK (${bot});`);
  }
};
exports.down = () => { throw new Error('Destructive rollback is not supported. Restore an authorized backup instead.'); };
