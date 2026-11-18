# Migrations

One file per release, named after the release that ships it:

```
2.1.0-photo-indexes.sql
└─────┘ └───────────┘
release   what it does
```

Rules, all of them enforced by the runner rather than trusted:

- **The version prefix is required and is SemVer.** Files are applied oldest
  first by version — `2.9.0` before `2.10.0` — not by filename order. A name the
  runner cannot parse is refused, and the process exits non-zero. The version is
  a release version (MAJOR.MINOR.PATCH); a prerelease suffix would be
  indistinguishable from a hyphenated description, so it is refused too.
  Migrations travel with tagged releases.
- **One file per release.** Two files claiming `2.1.0` is an error at startup.
  A release that needs several changes gets one file with several statements.
- **A migration runs once, ever.** It is recorded in `schema_migrations` with a
  checksum when it is applied, and never runs again on that database — so it does
  *not* have to be safe to replay. Write it as a single forward step.
- **A migration is for installs that already have data.** `db/schema.sql` is the
  schema a new install gets. If you add a table or column, add it to `schema.sql`
  in the same commit and treat the migration as the upgrade path for existing
  installs. Both must end in the same shape.
- **No going back.** There are no down-migrations: undoing a schema change means
  restoring a backup. Say so in the release notes when a change is hard to
  reverse.
- **Fail loudly at authoring time, not on a user's server.** `npm test` parses
  this directory and fails on a bad name, and `scripts/check-release.js` (repo
  root) refuses a release that adds a migration without declaring it in the
  release notes.

Check what an install still needs to run:

```bash
npm run db:status        # applied + pending, human readable
node db/init.js --json   # the same, machine readable
```

`npm run db:init` (the installer and the container entrypoint) applies the schema
and any pending migration, and exits non-zero if one fails.
