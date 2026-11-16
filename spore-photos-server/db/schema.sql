-- Spore-Photos Database Schema
-- PostgreSQL

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(100) UNIQUE NOT NULL,
    display_name VARCHAR(200) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login TIMESTAMPTZ
);

-- Albums table
CREATE TABLE IF NOT EXISTS albums (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    description TEXT,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cover_photo_id UUID,
    is_shared BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Photos table
CREATE TABLE IF NOT EXISTS photos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    album_id UUID REFERENCES albums(id) ON DELETE SET NULL,
    original_filename VARCHAR(500) NOT NULL,
    uuid_name VARCHAR(36) NOT NULL,
    date_taken DATE NOT NULL,
    month_folder VARCHAR(6) NOT NULL,
    relative_path TEXT NOT NULL,
    mime_type VARCHAR(50),
    file_size BIGINT,
    width INTEGER,
    height INTEGER,
    exif_data JSONB,
    description TEXT,
    tags TEXT[] DEFAULT '{}',
    is_archived BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Access codes for family sharing
CREATE TABLE IF NOT EXISTS access_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code_hash VARCHAR(255) NOT NULL,
    label VARCHAR(200),
    expires_at TIMESTAMPTZ NOT NULL,
    max_uses INTEGER,
    used_count INTEGER NOT NULL DEFAULT 0,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- IP addresses (whitelist + blacklist in one table)
CREATE TABLE IF NOT EXISTS ip_addresses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ip VARCHAR(45) UNIQUE NOT NULL,
    whitelisted BOOLEAN NOT NULL DEFAULT true,
    blacklisted BOOLEAN NOT NULL DEFAULT false,
    notes TEXT,
    create_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    update_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Known browser/device IDs
CREATE TABLE IF NOT EXISTS devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id VARCHAR(255) UNIQUE NOT NULL,
    create_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    update_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sessions (links IP, device, and user together)
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token VARCHAR(255) UNIQUE NOT NULL,
    ip_address_id UUID REFERENCES ip_addresses(id) ON DELETE SET NULL,
    device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    create_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    update_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expire_date TIMESTAMPTZ NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_photos_user_id ON photos(user_id);
CREATE INDEX IF NOT EXISTS idx_photos_album_id ON photos(album_id);
CREATE INDEX IF NOT EXISTS idx_photos_date_taken ON photos(date_taken);
CREATE INDEX IF NOT EXISTS idx_photos_month_folder ON photos(month_folder);
CREATE INDEX IF NOT EXISTS idx_photos_tags ON photos USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_albums_owner_id ON albums(owner_id);
CREATE INDEX IF NOT EXISTS idx_access_codes_is_active ON access_codes(is_active);

-- Indexes for new tables
CREATE INDEX IF NOT EXISTS idx_ip_addresses_ip ON ip_addresses(ip);
CREATE INDEX IF NOT EXISTS idx_ip_addresses_whitelisted ON ip_addresses(whitelisted);
CREATE INDEX IF NOT EXISTS idx_ip_addresses_blacklisted ON ip_addresses(blacklisted);
CREATE INDEX IF NOT EXISTS idx_devices_device_id ON devices(device_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_ip_address_id ON sessions(ip_address_id);
CREATE INDEX IF NOT EXISTS idx_sessions_device_id ON sessions(device_id);

-- Album-Photo junction table (many-to-many)
CREATE TABLE IF NOT EXISTS album_photos (
    album_id UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(album_id, photo_id)
);

CREATE INDEX IF NOT EXISTS idx_album_photos_album_id ON album_photos(album_id);
CREATE INDEX IF NOT EXISTS idx_album_photos_photo_id ON album_photos(photo_id);

-- Add cover_photo_id foreign key after photos table exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_albums_cover_photo'
    ) THEN
        ALTER TABLE albums ADD CONSTRAINT fk_albums_cover_photo
            FOREIGN KEY (cover_photo_id) REFERENCES photos(id) ON DELETE SET NULL
            NOT VALID;
    END IF;
END $$;

-- Share tokens for public photo/album sharing
CREATE TABLE IF NOT EXISTS share_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    access_type VARCHAR(20) NOT NULL DEFAULT 'public' CHECK (access_type IN ('public', 'internal')),
    shared_with_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(64) UNIQUE NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_share_tokens_token ON share_tokens(token);
CREATE INDEX IF NOT EXISTS idx_share_tokens_photo_id ON share_tokens(photo_id);

-- Album share tokens (one token for the whole album)
CREATE TABLE IF NOT EXISTS album_share_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    album_id UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    access_type VARCHAR(20) NOT NULL DEFAULT 'public' CHECK (access_type IN ('public', 'internal')),
    shared_with_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(64) UNIQUE NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_album_share_tokens_token ON album_share_tokens(token);
CREATE INDEX IF NOT EXISTS idx_album_share_tokens_album_id ON album_share_tokens(album_id);

-- Album user shares (individual user access grants)
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

-- Album collections for grouping albums
CREATE TABLE IF NOT EXISTS album_collections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_album_collections_owner_id ON album_collections(owner_id);

-- Add collection_id to albums
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'albums' AND column_name = 'collection_id'
    ) THEN
        ALTER TABLE albums ADD COLUMN collection_id UUID REFERENCES album_collections(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_albums_collection_id ON albums(collection_id);
    END IF;
END $$;

-- User preferences
CREATE TABLE IF NOT EXISTS user_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    photo_grid_size VARCHAR(10) NOT NULL DEFAULT 'md',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Application settings (server-wide key/value)
-- Currently holds 'photos_root' — an optional override for where photos are
-- read from / written to. Absent row => PICTURES_ROOT env var wins.
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
