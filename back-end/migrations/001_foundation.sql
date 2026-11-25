CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  display_name text,
  phone_original text,
  phone_e164 text,
  first_inbound_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE INDEX contacts_by_phone ON contacts (organization_id, phone_e164) WHERE phone_e164 IS NOT NULL;

CREATE TABLE contact_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  contact_id uuid NOT NULL,
  provider text NOT NULL,
  connection_id text NOT NULL,
  external_contact_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id),
  UNIQUE (organization_id, provider, connection_id, external_contact_id)
);

CREATE TABLE channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  connection_id text NOT NULL,
  external_id text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  UNIQUE (organization_id, connection_id, external_id),
  UNIQUE (organization_id, id)
);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  connection_id text NOT NULL,
  external_id text NOT NULL,
  channel_id uuid,
  contact_id uuid,
  external_state text,
  first_event_at timestamptz,
  last_event_at timestamptz,
  history_limited boolean NOT NULL DEFAULT false,
  raw_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, channel_id) REFERENCES channels(organization_id, id),
  FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id),
  UNIQUE (organization_id, connection_id, external_id),
  UNIQUE (organization_id, id)
);
CREATE INDEX conversations_recent ON conversations (organization_id, last_event_at DESC, id DESC);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  conversation_id uuid NOT NULL,
  connection_id text NOT NULL,
  external_id text NOT NULL,
  event_at timestamptz NOT NULL,
  author_kind text NOT NULL,
  message_type text NOT NULL,
  is_private boolean NOT NULL DEFAULT false,
  content text,
  raw_json jsonb,
  source_hash text NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, conversation_id) REFERENCES conversations(organization_id, id),
  UNIQUE (organization_id, connection_id, conversation_id, external_id)
);
CREATE INDEX messages_timeline ON messages (organization_id, conversation_id, event_at DESC, external_id DESC);

CREATE TABLE sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  provider text NOT NULL,
  job_kind text NOT NULL,
  logical_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','retry_wait','succeeded','partial','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  run_after timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sync_jobs_one_active ON sync_jobs (organization_id, logical_key)
  WHERE status IN ('queued','running','retry_wait');

CREATE TABLE sync_checkpoints (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  provider text NOT NULL,
  resource_key text NOT NULL,
  cursor_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  coverage_status text NOT NULL DEFAULT 'unknown',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, provider, resource_key)
);

CREATE TABLE integration_leases (
  lease_key text PRIMARY KEY,
  owner_id text NOT NULL,
  generation bigint NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE provider_budgets (
  budget_key text PRIMARY KEY,
  next_allowed_at timestamptz NOT NULL DEFAULT now(),
  cooldown_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX outbox_pending ON outbox (created_at) WHERE published_at IS NULL;
