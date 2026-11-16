-- Spore-Photos Migration: Share Rebuild
-- Run against existing DB to add album_user_share table
-- and extend existing share token tables

-- ── album_user_share: grants individual user access to an album ──
CREATE TABLE IF NOT EXISTS album_user_share (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    album_id UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shared_with_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(album_id, shared_with_user_id)
);

CREATE INDEX IF NOT EXISTS idx_album_user_share_shared_with ON album_user_share(shared_with_user_id);
CREATE INDEX IF NOT EXISTS idx_album_user_share_album ON album_user_share(album_id);
CREATE INDEX IF NOT EXISTS idx_album_user_share_owner ON album_user_share(owner_id);

-- Extend share_tokens with internal sharing support
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'share_tokens' AND column_name = 'access_type'
    ) THEN
        ALTER TABLE share_tokens ADD COLUMN access_type VARCHAR(20) NOT NULL DEFAULT 'public'
            CHECK (access_type IN ('public', 'internal'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'share_tokens' AND column_name = 'shared_with_user_id'
    ) THEN
        ALTER TABLE share_tokens ADD COLUMN shared_with_user_id UUID REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Extend album_share_tokens with internal sharing support
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'album_share_tokens' AND column_name = 'access_type'
    ) THEN
        ALTER TABLE album_share_tokens ADD COLUMN access_type VARCHAR(20) NOT NULL DEFAULT 'public'
            CHECK (access_type IN ('public', 'internal'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'album_share_tokens' AND column_name = 'shared_with_user_id'
    ) THEN
        ALTER TABLE album_share_tokens ADD COLUMN shared_with_user_id UUID REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
