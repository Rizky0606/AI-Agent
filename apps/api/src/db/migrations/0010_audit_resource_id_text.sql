-- audit_logs.resource_id must hold any resource identifier, not only uuids. Tool calls record
-- paths, URLs, filenames, and tool names there, and a uuid column rejected them with 22P02.
ALTER TABLE audit_logs ALTER COLUMN resource_id TYPE varchar(512) USING resource_id::text;
