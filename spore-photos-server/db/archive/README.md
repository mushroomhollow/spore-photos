# Archived migrations

These three shipped before migrations were versioned, when `db/init.js` re-ran
every `migrate-*.sql` on every start.

```
migrate-20260720-share-rebuild.sql    album_user_share + share token access_type
migrate-20261020-app-settings.sql     app_settings key/value table
migrate-20261112-client-tokens.sql    devices.client_token_hash + authorised flag
```

They are **never run again**, by anything:

- Their effects are in `db/schema.sql`, which is what a new install runs — every
  statement in it is guarded, so an install that already has these objects is
  unaffected.
- The first start under the current scheme records all three in
  `schema_migrations` (see `LEGACY_MIGRATIONS` in `../migrate.js`), so they count
  as applied and are not replayed.

## Where an applied versioned migration goes

A migration named for a release (`2.1.0-photo-indexes.sql`) that has already been
applied may be moved here once a later release ships its own. The runner counts a
file found in this directory as present when it reports what has gone missing, so
moving it does not produce a spurious "recorded as applied but is no longer in
db/migrations/". It is never applied from here — `db/migrations/` is the only
directory the runner reads for pending work, which is also why an *unapplied* file
parked here would be silently skipped: if you move one, move it after its release
has shipped, not before.

The three dated files above predate versioned migrations, so their names cannot be
ordered and they are handled by `LEGACY_MIGRATIONS` instead.

They are kept as the record of what each one did, the way a changelog carries its
own history.
