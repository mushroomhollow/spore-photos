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

They are kept here as the record of what each one did, the way a changelog
carries its own history. New migrations do not belong here — they go in
`../migrations/`, named after the release that ships them.
